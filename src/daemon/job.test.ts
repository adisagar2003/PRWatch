import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runReviewJob } from './job.js';
import { MARKER } from '../forge/github.js';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

const pr: PR = { number: 5, title: 'T', body: 'B', createdAt: '2026-07-22T00:00:00Z', headRef: 'x', author: 'adi' };

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 one
+two
`;

const LONG_REVIEW = 'Verdict: APPROVE. '.repeat(10); // > 50 chars

function fakeForge(over: Partial<ForgeAdapter> = {}): ForgeAdapter {
  return {
    name: 'fake',
    listOpenPRs: async () => [],
    getDiff: async () => DIFF,
    postLineComments: vi.fn(async () => {}),
    isOpen: async () => true,
    clone: async (_repo, _pr, dir) => { await fs.mkdir(dir, { recursive: true }); },
    hasMarkerComment: async () => false,
    postComment: vi.fn(async () => {}),
    ...over,
  };
}

function fakeAgent(review: () => Promise<string>): AgentAdapter {
  return { name: 'claude', isInstalled: async () => true, review };
}

function deps(forge: ForgeAdapter, agent: AgentAdapter) {
  return { forge, agent, cacheRoot: path.join(tmp, 'cache'), timeoutMs: 5000, log: () => {} };
}

describe('runReviewJob: line comments', () => {
  const withComments = LONG_REVIEW + '\n\n```prwatch-comments\n' + JSON.stringify([
    { path: 'a.ts', line: 2, body: 'Rename', suggestion: 'const two = 2;' },
    { path: 'a.ts', line: 40, body: 'not in the diff' },
  ]) + '\n```';
  const on = (f: ForgeAdapter, review: () => Promise<string>) =>
    ({ ...deps(f, fakeAgent(review)), lineComments: true });

  it('posts the summary without the JSON, then the line comments that are in the diff', async () => {
    const forge = fakeForge();
    expect(await runReviewJob(on(forge, async () => withComments), 'a/b', pr)).toBe('posted');
    const body = (forge.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).not.toContain('prwatch-comments');
    const sent = (forge.postLineComments as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(sent).toEqual([{ path: 'a.ts', line: 2, body: 'Rename\n\n```suggestion\nconst two = 2;\n```' }]);
  });

  it('asks the agent for line comments only when enabled', async () => {
    const prompts: string[] = [];
    const agent = fakeAgent(async () => LONG_REVIEW);
    agent.review = async (o) => { prompts.push(o.prompt); return LONG_REVIEW; };
    await runReviewJob(deps(fakeForge(), agent), 'a/b', pr);
    await runReviewJob({ ...deps(fakeForge(), agent), lineComments: true }, 'a/b', pr);
    expect(prompts[0]).not.toContain('prwatch-comments');
    expect(prompts[1]).toContain('prwatch-comments');
  });

  it('still counts as posted when the line comments fail — the summary is the review', async () => {
    const forge = fakeForge({ postLineComments: vi.fn(async () => { throw new Error('422'); }) });
    expect(await runReviewJob(on(forge, async () => withComments), 'a/b', pr)).toBe('posted');
    expect(forge.postComment).toHaveBeenCalledTimes(1);
  });

  it('skips the line-comment call when none survive the diff check', async () => {
    const forge = fakeForge();
    const offDiff = LONG_REVIEW + '\n\n```prwatch-comments\n[{"path":"z.ts","line":1,"body":"b"}]\n```';
    await runReviewJob(on(forge, async () => offDiff), 'a/b', pr);
    expect(forge.postLineComments).not.toHaveBeenCalled();
  });
});

describe('runReviewJob', () => {
  it('posts a marked comment and cleans the clone', async () => {
    const forge = fakeForge();
    const result = await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    expect(result).toBe('posted');
    const body = (forge.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('APPROVE');
    await expect(fs.readdir(path.join(tmp, 'cache'))).resolves.toEqual([]);
  });

  it('appends the PRWatch attribution footer naming the agent', async () => {
    const forge = fakeForge();
    await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    const body = (forge.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).toContain('👁️🌀');
    expect(body).toContain('By [PRWatch](https://github.com/adisagar2003/PRWatch)');
    expect(body).toContain('`claude`');
    expect(body.startsWith(MARKER)).toBe(true); // footer must not displace the marker
  });

  it('skips when a marked comment already exists (no clone made)', async () => {
    const forge = fakeForge({ hasMarkerComment: async () => true, clone: vi.fn() });
    const result = await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    expect(result).toBe('skipped-existing');
    expect(forge.clone).not.toHaveBeenCalled();
  });

  it('returns failed and still cleans up when the agent throws', async () => {
    const forge = fakeForge();
    const result = await runReviewJob(
      deps(forge, fakeAgent(async () => { throw new Error('agent died'); })),
      'a/b', pr,
    );
    expect(result).toBe('failed');
    expect(forge.postComment).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tmp, 'cache'))).resolves.toEqual([]);
  });

  it('treats short/garbage agent output as failure and does not post', async () => {
    const forge = fakeForge();
    const result = await runReviewJob(deps(forge, fakeAgent(async () => 'ok')), 'a/b', pr);
    expect(result).toBe('failed');
    expect(forge.postComment).not.toHaveBeenCalled();
  });

  it('resolves failed (not rejects) when the marker check throws', async () => {
    const forge = fakeForge({
      hasMarkerComment: async () => { throw new Error('api down'); },
      clone: vi.fn(),
    });
    await expect(
      runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr),
    ).resolves.toBe('failed');
    expect(forge.clone).not.toHaveBeenCalled();
    expect(forge.postComment).not.toHaveBeenCalled();
  });

  it('skips a PR that is no longer open without cloning or commenting', async () => {
    const forge = fakeForge({ isOpen: async () => false, clone: vi.fn() });
    const result = await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    expect(result).toBe('skipped-closed');
    expect(forge.clone).not.toHaveBeenCalled();
    expect(forge.postComment).not.toHaveBeenCalled();
  });

  it('does not comment when the PR gets merged while the agent is reviewing', async () => {
    const isOpen = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true) // pre-clone check: still open
      .mockResolvedValueOnce(false); // post-review check: merged meanwhile
    const forge = fakeForge({ isOpen });
    const result = await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    expect(result).toBe('skipped-closed');
    expect(isOpen).toHaveBeenCalledTimes(2);
    expect(forge.postComment).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tmp, 'cache'))).resolves.toEqual([]); // clone still cleaned
  });

  it('uses the repo rubric override when the clone contains .prwatch/rubric.md', async () => {
    let seenPrompt = '';
    const forge = fakeForge({
      clone: async (_r, _p, dir) => {
        await fs.mkdir(path.join(dir, '.prwatch'), { recursive: true });
        await fs.writeFile(path.join(dir, '.prwatch', 'rubric.md'), 'REPO SPECIFIC RUBRIC');
      },
    });
    const agent = fakeAgent(async () => LONG_REVIEW);
    const spy = vi.spyOn(agent, 'review').mockImplementation(async ({ prompt }) => {
      seenPrompt = prompt;
      return LONG_REVIEW;
    });
    await runReviewJob(deps(forge, agent), 'a/b', pr);
    expect(seenPrompt).toContain('REPO SPECIFIC RUBRIC');
    spy.mockRestore();
  });
});
