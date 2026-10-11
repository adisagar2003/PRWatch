import { describe, it, expect, vi } from 'vitest';
import { GitHubForge, MARKER, type Exec } from './github.js';

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
        head: { ref: 'fix/bug' }, user: { login: 'adi' },
      },
    ]);
    const { exec } = fakeExec({ 'gh api repos/a/b/pulls': apiJson });
    const prs = await new GitHubForge(exec).listOpenPRs('a/b');
    expect(prs).toEqual([
      { number: 7, title: 'Fix bug', body: '', createdAt: '2026-07-21T10:00:00Z', headRef: 'fix/bug', author: 'adi' },
    ]);
  });

  it('clone shallow-clones then checks out the PR head via the fork-safe pull ref', async () => {
    const { exec, calls } = fakeExec({});
    await new GitHubForge(exec).clone('a/b', 7, '/tmp/x');
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

  it('hasMarkerComment detects the marker', async () => {
    const comments = JSON.stringify([{ body: 'hi' }, { body: `${MARKER}\nold review` }]);
    const { exec } = fakeExec({ 'gh api repos/a/b/issues/7/comments': comments });
    expect(await new GitHubForge(exec).hasMarkerComment('a/b', 7)).toBe(true);
  });

  it('hasMarkerComment is false without the marker', async () => {
    const { exec } = fakeExec({ 'gh api repos/a/b/issues/7/comments': '[]' });
    expect(await new GitHubForge(exec).hasMarkerComment('a/b', 7)).toBe(false);
  });

  it('postComment passes the body via a temp file', async () => {
    const { exec, calls } = fakeExec({});
    await new GitHubForge(exec).postComment('a/b', 7, 'review body');
    const call = calls[0];
    expect(call.slice(0, 5)).toEqual(['gh', 'pr', 'comment', '7', '--repo']);
    expect(call).toContain('--body-file');
  });

  it('getDiff asks gh for the exact diff GitHub reviews against', async () => {
    const { exec, calls } = fakeExec({ 'gh pr diff 7': 'DIFF' });
    expect(await new GitHubForge(exec).getDiff('a/b', 7)).toBe('DIFF');
    expect(calls[0]).toEqual(['gh', 'pr', 'diff', '7', '--repo', 'a/b']);
  });

  it('postLineComments sends one COMMENT review with right-side line comments', async () => {
    let sent: unknown;
    const exec: Exec = async (cmd, args) => {
      const i = args.indexOf('--input');
      if (i >= 0) sent = JSON.parse(await (await import('node:fs/promises')).readFile(args[i + 1], 'utf8'));
      return { stdout: '{}' };
    };
    await new GitHubForge(exec).postLineComments('a/b', 7, [
      { path: 'a.ts', line: 3, body: 'one' },
      { path: 'a.ts', line: 6, startLine: 5, body: 'two' },
    ]);
    expect(sent).toEqual({
      event: 'COMMENT',
      comments: [
        { path: 'a.ts', line: 3, side: 'RIGHT', body: 'one' },
        { path: 'a.ts', line: 6, side: 'RIGHT', start_line: 5, start_side: 'RIGHT', body: 'two' },
      ],
    });
  });
});
