import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../run-command.js';
import type { ForgeAdapter, PR } from './types.js';

export const MARKER = '<!-- prwatch -->';
/** Second, per-head marker: lets a re-review check it hasn't already posted for this exact commit. */
export const headMarker = (sha: string) => `<!-- prwatch head=${sha} -->`;

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string }>;

export const defaultExec: Exec = async (cmd, args, opts) => ({
  stdout: await runCommand(cmd, args, { cwd: opts?.cwd, timeoutMs: 120_000 }),
});

export async function checkGhAuth(exec: Exec = defaultExec): Promise<boolean> {
  try {
    await exec('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

/** List the authenticated user's repos as "owner/name", newest-updated first. */
export async function listUserRepos(
  limit = 300,
  exec: Exec = defaultExec,
): Promise<string[]> {
  const { stdout } = await exec('gh', [
    'repo',
    'list',
    '--limit',
    String(limit),
    '--json',
    'nameWithOwner',
  ]);
  const raw = JSON.parse(stdout) as Array<{ nameWithOwner: string }>;
  return raw.map((r) => r.nameWithOwner);
}

export class GitHubForge implements ForgeAdapter {
  name = 'github';

  constructor(private exec: Exec = defaultExec) {}

  private login?: Promise<string>;

  /** The gh user prwatch posts as, looked up once; a failed lookup is retried next call. */
  private viewer(): Promise<string> {
    this.login ??= this.exec('gh', ['api', 'user', '--jq', '.login']).then(
      ({ stdout }) => stdout.trim(),
      (e) => { this.login = undefined; throw e; },
    );
    return this.login;
  }

  async listOpenPRs(repo: string): Promise<PR[]> {
    const { stdout } = await this.exec('gh', [
      'api',
      `repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=50`,
    ]);
    const raw = JSON.parse(stdout) as Array<{
      number: number; title: string; body: string | null;
      created_at: string; head: { ref: string; sha: string; repo: { full_name: string } | null };
      base: { ref: string }; user: { login: string };
    }>;
    return raw.map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body ?? '',
      createdAt: p.created_at,
      headRef: p.head.ref,
      headSha: p.head.sha,
      baseRef: p.base.ref,
      // GitHub names are case-insensitive; the configured repo may not match full_name's case.
      fromFork: p.head.repo?.full_name.toLowerCase() !== repo.toLowerCase(),
      author: p.user.login,
    }));
  }

  async isOpen(repo: string, pr: number): Promise<boolean> {
    const { stdout } = await this.exec('gh', ['api', `repos/${repo}/pulls/${pr}`]);
    return (JSON.parse(stdout) as { state: string }).state === 'open';
  }

  async isConflicting(repo: string, pr: number): Promise<boolean> {
    const { stdout } = await this.exec('gh', ['api', `repos/${repo}/pulls/${pr}`]);
    // mergeable is null while GitHub is still computing it — say no and retry next tick.
    return (JSON.parse(stdout) as { mergeable: boolean | null }).mergeable === false;
  }

  async clone(repo: string, pr: number, dir: string): Promise<string> {
    await this.exec('gh', ['repo', 'clone', repo, dir, '--', '--depth', '50']);
    // Not `gh pr checkout`: shallow clones are implicitly single-branch, so it
    // cannot create a tracking branch. refs/pull/N/head also covers fork PRs.
    await this.exec('git', ['fetch', '--depth', '50', 'origin', `pull/${pr}/head:prwatch-pr`], {
      cwd: dir,
    });
    await this.exec('git', ['checkout', 'prwatch-pr'], { cwd: dir });
    // May be newer than the PR listing if the author pushed in between.
    const { stdout } = await this.exec('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return stdout.trim();
  }

  async hasMarkerComment(repo: string, pr: number, marker = MARKER): Promise<boolean> {
    const me = await this.viewer();
    // --paginate prints one JSON array per page, which don't join into valid JSON,
    // so --jq emits one comment object per line instead.
    const { stdout } = await this.exec('gh', [
      'api', '--paginate',
      `repos/${repo}/issues/${pr}/comments?per_page=100`,
      '--jq', '.[] | {login: .user.login, body} | @json',
    ]);
    // Only our own comments count: anyone can post a marker to suppress a review.
    return stdout.split('\n').filter((l) => l.trim() !== '').some((line) => {
      const c = JSON.parse(line) as { login?: string; body?: string };
      return c.login === me && typeof c.body === 'string' && c.body.includes(marker);
    });
  }

  async postComment(repo: string, pr: number, body: string): Promise<void> {
    const file = path.join(os.tmpdir(), `prwatch-comment-${pr}-${process.pid}.md`);
    await fs.writeFile(file, body);
    try {
      await this.exec('gh', ['pr', 'comment', String(pr), '--repo', repo, '--body-file', file]);
    } finally {
      await fs.rm(file, { force: true });
    }
  }
}
