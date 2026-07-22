import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../run-command.js';
import type { ForgeAdapter, PR } from './types.js';

export const MARKER = '<!-- prwatch -->';

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

export class GitHubForge implements ForgeAdapter {
  name = 'github';

  constructor(private exec: Exec = defaultExec) {}

  async listOpenPRs(repo: string): Promise<PR[]> {
    const { stdout } = await this.exec('gh', [
      'api',
      `repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=50`,
    ]);
    const raw = JSON.parse(stdout) as Array<{
      number: number; title: string; body: string | null;
      created_at: string; head: { ref: string }; user: { login: string };
    }>;
    return raw.map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body ?? '',
      createdAt: p.created_at,
      headRef: p.head.ref,
      author: p.user.login,
    }));
  }

  async isOpen(repo: string, pr: number): Promise<boolean> {
    const { stdout } = await this.exec('gh', ['api', `repos/${repo}/pulls/${pr}`]);
    return (JSON.parse(stdout) as { state: string }).state === 'open';
  }

  async clone(repo: string, pr: number, dir: string): Promise<void> {
    await this.exec('gh', ['repo', 'clone', repo, dir, '--', '--depth', '50']);
    await this.exec('gh', ['pr', 'checkout', String(pr)], { cwd: dir });
  }

  async hasMarkerComment(repo: string, pr: number): Promise<boolean> {
    const { stdout } = await this.exec('gh', [
      'api',
      `repos/${repo}/issues/${pr}/comments?per_page=100`,
    ]);
    const comments = JSON.parse(stdout) as Array<{ body?: string }>;
    return comments.some((c) => typeof c.body === 'string' && c.body.includes(MARKER));
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
