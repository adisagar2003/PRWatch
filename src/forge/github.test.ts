import { describe, it, expect, vi } from 'vitest';
import { GitHubForge, MARKER, headMarker, type Exec } from './github.js';

function fakeExec(responses: Record<string, string>): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.join(' ')}`;
    const hit = Object.keys(responses).find((k) => key.startsWith(k));
    return { stdout: hit ? responses[hit] : '' };
  };
  return { exec, calls };
}

describe('GitHubForge', () => {
  it('listOpenPRs maps the gh api response to PR objects', async () => {
    const apiJson = JSON.stringify([
      {
        number: 7, title: 'Fix bug', body: null,
        created_at: '2026-07-21T10:00:00Z',
        head: { ref: 'fix/bug', sha: 'deadbee', repo: { full_name: 'A/B' } }, // case differs from config: still not a fork
        base: { ref: 'main' }, user: { login: 'adi' },
      },
    ]);
    const { exec } = fakeExec({ 'gh api repos/a/b/pulls': apiJson });
    const prs = await new GitHubForge(exec).listOpenPRs('a/b');
    expect(prs).toEqual([
      {
        number: 7, title: 'Fix bug', body: '', createdAt: '2026-07-21T10:00:00Z',
        headRef: 'fix/bug', headSha: 'deadbee', baseRef: 'main', fromFork: false, author: 'adi',
      },
    ]);
  });

  it('isConflicting is true only when GitHub says mergeable is false', async () => {
    const cases: Array<[string, boolean]> = [
      ['{"mergeable":false}', true],
      ['{"mergeable":true}', false],
      ['{"mergeable":null}', false], // still being computed — retry next tick
    ];
    for (const [json, expected] of cases) {
      const { exec } = fakeExec({ 'gh api repos/a/b/pulls/7': json });
      expect(await new GitHubForge(exec).isConflicting('a/b', 7)).toBe(expected);
    }
  });

  it('clone shallow-clones then checks out the PR head via the fork-safe pull ref', async () => {
    const { exec, calls } = fakeExec({ 'git rev-parse HEAD': 'cafe123\n' });
    expect(await new GitHubForge(exec).clone('a/b', 7, '/tmp/x')).toBe('cafe123');
    expect(calls[0]).toEqual(['gh', 'repo', 'clone', 'a/b', '/tmp/x', '--', '--depth', '50']);
    // gh pr checkout breaks in shallow (implicitly single-branch) clones:
    // it cannot create tracking branches, so fetch refs/pull/N/head directly.
    expect(calls[1]).toEqual(['git', 'fetch', '--depth', '50', 'origin', 'pull/7/head:prwatch-pr']);
    expect(calls[2]).toEqual(['git', 'checkout', 'prwatch-pr']);
  });

  it('isOpen is true only for state=open', async () => {
    const { exec: openExec } = fakeExec({ 'gh api repos/a/b/pulls/7': '{"state":"open"}' });
    expect(await new GitHubForge(openExec).isOpen('a/b', 7)).toBe(true);
    const { exec: closedExec } = fakeExec({ 'gh api repos/a/b/pulls/7': '{"state":"closed"}' });
    expect(await new GitHubForge(closedExec).isOpen('a/b', 7)).toBe(false);
  });

  /** gh --paginate --jq output: one comment per line, as many pages as GitHub returns. */
  const lines = (...cs: Array<{ login: string; body: string }>) =>
    cs.map((c) => JSON.stringify(c)).join('\n') + '\n';
  const markerForge = (comments: string) => fakeExec({
    'gh api user': 'prwatch-bot\n',
    'gh api --paginate repos/a/b/issues/7/comments': comments,
  });

  it('hasMarkerComment detects our marker on any page', async () => {
    const page1 = Array.from({ length: 100 }, () => ({ login: 'someone', body: 'hi' }));
    const { exec, calls } = markerForge(
      lines(...page1, { login: 'prwatch-bot', body: `${MARKER}\nold review` }),
    );
    expect(await new GitHubForge(exec).hasMarkerComment('a/b', 7)).toBe(true);
    expect(calls.find((c) => c.includes('--paginate'))).toContain('--jq');
  });

  it('hasMarkerComment ignores markers posted by anyone else', async () => {
    const { exec } = markerForge(lines({ login: 'pr-author', body: `${MARKER}\n${headMarker('sha1')}` }));
    const forge = new GitHubForge(exec);
    expect(await forge.hasMarkerComment('a/b', 7)).toBe(false);
    expect(await forge.hasMarkerComment('a/b', 7, headMarker('sha1'))).toBe(false);
  });

  it('hasMarkerComment can look for a specific head marker', async () => {
    const { exec, calls } = markerForge(lines({ login: 'prwatch-bot', body: `${MARKER}\n${headMarker('sha1')}\nold` }));
    const forge = new GitHubForge(exec);
    expect(await forge.hasMarkerComment('a/b', 7, headMarker('sha1'))).toBe(true);
    expect(await forge.hasMarkerComment('a/b', 7, headMarker('sha2'))).toBe(false);
    expect(calls.filter((c) => c.join(' ') === 'gh api user --jq .login')).toHaveLength(1);
  });

  it('hasMarkerComment is false without comments', async () => {
    const { exec } = markerForge('');
    expect(await new GitHubForge(exec).hasMarkerComment('a/b', 7)).toBe(false);
  });

  it('postComment passes the body via a temp file', async () => {
    const { exec, calls } = fakeExec({});
    await new GitHubForge(exec).postComment('a/b', 7, 'review body');
    const call = calls[0];
    expect(call.slice(0, 5)).toEqual(['gh', 'pr', 'comment', '7', '--repo']);
    expect(call).toContain('--body-file');
  });
});
