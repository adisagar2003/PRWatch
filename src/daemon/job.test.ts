import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runReviewJob } from './job.js';
import { MARKER, headMarker } from '../forge/github.js';
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

const pr: PR = {
  number: 5, title: 'T', body: 'B', createdAt: '2026-07-22T00:00:00Z',
  headRef: 'x', headSha: 'sha1', baseRef: 'main', fromFork: false, author: 'adi',
};

const LONG_REVIEW = 'Verdict: APPROVE. '.repeat(10); // > 50 chars

function fakeForge(over: Partial<ForgeAdapter> = {}, clonedHead = 'sha1'): ForgeAdapter {
  return {
    name: 'fake',
    listOpenPRs: async () => [],
    isOpen: async () => true,
    isConflicting: async () => false,
    clone: async (_repo, _pr, dir) => { await fs.mkdir(dir, { recursive: true }); return clonedHead; },
    hasMarkerComment: async () => false,
    postComment: vi.fn(async () => {}),
    ...over,
  };
}

function fakeAgent(review: () => Promise<string>): AgentAdapter {
  return {
    name: 'claude', hasAuthCheck: false, isInstalled: async () => true,
    checkAuth: async () => 'unknown', review,
  };
}

function deps(forge: ForgeAdapter, agent: AgentAdapter) {
  return { forge, agent, cacheRoot: path.join(tmp, 'cache'), timeoutMs: 5000, log: () => {} };
}

describe('runReviewJob: re-review', () => {
  const bodyOf = (f: ForgeAdapter) =>
    (f.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;

  it('stamps every review with a marker for the head it covered', async () => {
    const forge = fakeForge();
    await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr);
    expect(bodyOf(forge)).toContain(headMarker('sha1'));
    expect(bodyOf(forge)).not.toContain('Re-review');
  });

  it('labels a re-review and asks the agent for the changes since the old SHA', async () => {
    const forge = fakeForge();
    let prompt = '';
    const agent = fakeAgent(async () => LONG_REVIEW);
    agent.review = async (o) => { prompt = o.prompt; return LONG_REVIEW; };
    expect(await runReviewJob(deps(forge, agent), 'a/b', pr, 'old1234567')).toBe('posted');
    expect(prompt).toContain('git diff old1234567 HEAD');
    expect(bodyOf(forge)).toContain('🔁 Re-review');
    expect(bodyOf(forge)).toContain('`old1234`');
  });

  it('re-review checks for the head marker, not any prwatch comment', async () => {
    const seen: (string | undefined)[] = [];
    const forge = fakeForge({ hasMarkerComment: async (_r, _p, m) => { seen.push(m); return false; } });
    await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr, 'old');
    expect(seen).toEqual([headMarker('sha1')]);
  });

  it('stamps and reports the cloned head when the author pushed after the listing', async () => {
    const seen: (string | undefined)[] = [];
    const forge = fakeForge({ hasMarkerComment: async (_r, _p, m) => { seen.push(m); return false; } }, 'sha2');
    const reported: string[] = [];
    const d = { ...deps(forge, fakeAgent(async () => LONG_REVIEW)), onReviewedHead: (s: string) => reported.push(s) };
    expect(await runReviewJob(d, 'a/b', pr, 'old')).toBe('posted');
    expect(seen).toEqual([headMarker('sha1'), headMarker('sha2')]);
    expect(bodyOf(forge)).toContain(headMarker('sha2'));
    expect(bodyOf(forge)).not.toContain(headMarker('sha1'));
    expect(reported).toEqual(['sha2']);
  });

  it('skips when the newer cloned head was already reviewed', async () => {
    const forge = fakeForge({ hasMarkerComment: async (_r, _p, m) => m === headMarker('sha2') }, 'sha2');
    const result = await runReviewJob(deps(forge, fakeAgent(async () => LONG_REVIEW)), 'a/b', pr, 'old');
    expect(result).toBe('skipped-existing');
    expect(forge.postComment).not.toHaveBeenCalled();
  });

  it('skips without posting when the cloned head is the one already reviewed', async () => {
    const forge = fakeForge({}, 'old');
    const agent = fakeAgent(vi.fn(async () => LONG_REVIEW));
    const result = await runReviewJob(deps(forge, agent), 'a/b', pr, 'old');
    expect(result).toBe('skipped-existing');
    expect(agent.review).not.toHaveBeenCalled();
    expect(forge.postComment).not.toHaveBeenCalled();
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

  it('passes the configured review profile into the prompt', async () => {
    let prompt = '';
    const agent = fakeAgent(async () => LONG_REVIEW);
    agent.review = async (opts) => { prompt = opts.prompt; return LONG_REVIEW; };
    await runReviewJob({ ...deps(fakeForge(), agent), profile: 'quiet' }, 'a/b', pr);
    expect(prompt).toContain('Review profile: quiet');
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
        return 'sha1';
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
