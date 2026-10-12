import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tick } from './loop.js';
import { ensureRepoState, MAX_ATTEMPTS, type State } from '../state.js';
import { DEFAULT_CONFIG, type Config } from '../config.js';
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

const LONG_REVIEW = 'Verdict: APPROVE. '.repeat(10);

const mkPr = (n: number, createdAt: string): PR => ({
  number: n, title: `PR ${n}`, body: '', createdAt,
  headRef: 'b', headSha: 'sha1', baseRef: 'main', fromFork: false, author: 'adi',
});

function fakeForge(prs: PR[]): ForgeAdapter {
  return {
    name: 'fake',
    listOpenPRs: async () => prs,
    getDiff: async () => '',
    postLineComments: vi.fn(async () => {}),
    isOpen: async () => true,
    isConflicting: async () => false,
    clone: async (_r, n, dir) => {
      await fs.mkdir(dir, { recursive: true });
      return prs.find((p) => p.number === n)!.headSha;
    },
    hasMarkerComment: async () => false,
    postComment: vi.fn(async () => {}),
  };
}

const okAgent: AgentAdapter = {
  name: 'claude', hasAuthCheck: false, isInstalled: async () => true,
  checkAuth: async () => 'unknown', review: async () => LONG_REVIEW,
};

function makeDeps(
  forge: ForgeAdapter, agent: AgentAdapter, state: State, over: Partial<Config> = {},
) {
  ensureRepoState(state, 'a/b', new Date('2026-07-21T00:00:00Z'));
  return {
    forge, agent, state,
    notify: vi.fn(),
    config: { ...DEFAULT_CONFIG, repos: ['a/b'], ...over },
    saveState: vi.fn(async () => {}),
    cacheRoot: path.join(tmp, 'cache'),
    log: () => {},
    now: () => new Date('2026-07-23T00:00:00Z'),
  };
}

describe('tick', () => {
  it('reviews only new PRs and records them in the ledger', async () => {
    const forge = fakeForge([mkPr(1, '2026-07-20T00:00:00Z'), mkPr(2, '2026-07-22T00:00:00Z')]);
    const state: State = { lastTickAt: null, repos: {} };
    const deps = makeDeps(forge, okAgent, state);
    await tick(deps);
    expect(forge.postComment).toHaveBeenCalledTimes(1);
    expect(state.repos['a/b'].reviewed).toEqual([2]);
    expect(state.lastTickAt).toBe('2026-07-23T00:00:00.000Z');
    expect(deps.saveState).toHaveBeenCalled();
  });

  it('records a failure without crashing the tick', async () => {
    const forge = fakeForge([mkPr(3, '2026-07-22T00:00:00Z')]);
    const badAgent: AgentAdapter = {
      name: 'claude', isInstalled: async () => true,
      review: async () => { throw new Error('boom'); },
    };
    const state: State = { lastTickAt: null, repos: {} };
    await tick(makeDeps(forge, badAgent, state));
    expect(state.repos['a/b'].reviewed).toEqual([]);
    expect(state.repos['a/b'].retries['3']).toBe(1);
  });

  it('survives a forge listing error and still stamps lastTickAt', async () => {
    const forge = fakeForge([]);
    forge.listOpenPRs = async () => { throw new Error('rate limited'); };
    const state: State = { lastTickAt: null, repos: {} };
    await tick(makeDeps(forge, okAgent, state));
    expect(state.lastTickAt).toBe('2026-07-23T00:00:00.000Z');
  });

  it('sends a desktop notification naming the PR when a review is posted', async () => {
    const forge = fakeForge([mkPr(7, '2026-07-22T00:00:00Z')]);
    const state: State = { lastTickAt: null, repos: {} };
    const deps = makeDeps(forge, okAgent, state);
    await tick(deps);
    expect(deps.notify).toHaveBeenCalledWith('PRWatch', expect.stringContaining('a/b#7'));
    expect(deps.notify).toHaveBeenCalledWith('PRWatch', expect.stringContaining('posted'));
  });

  it('notifies once a PR is given up on, not on every retryable failure', async () => {
    const forge = fakeForge([mkPr(8, '2026-07-22T00:00:00Z')]);
    const badAgent: AgentAdapter = {
      name: 'claude', isInstalled: async () => true,
      review: async () => { throw new Error('boom'); },
    };
    const state: State = { lastTickAt: null, repos: {} };
    const deps = makeDeps(forge, badAgent, state);

    await tick(deps);
    expect(deps.notify).not.toHaveBeenCalled(); // retry still pending — log only

    for (let i = 1; i < MAX_ATTEMPTS; i++) await tick(deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith('PRWatch', expect.stringContaining('failed'));
  });

  it('stays silent when notifications are disabled in config', async () => {
    const forge = fakeForge([mkPr(9, '2026-07-22T00:00:00Z')]);
    const state: State = { lastTickAt: null, repos: {} };
    const deps = makeDeps(forge, okAgent, state, { notifications: false });
    await tick(deps);
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe('tick conflict resolution', () => {
  const fresh = (over: Partial<ForgeAdapter>) => {
    const forge = { ...fakeForge([mkPr(1, '2026-07-22T00:00:00Z')]), ...over };
    return forge as ForgeAdapter;
  };

  it('never asks about conflicts while autoResolveConflicts is off', async () => {
    const isConflicting = vi.fn(async () => true);
    const state: State = { lastTickAt: null, repos: {} };
    await tick(makeDeps(fresh({ isConflicting }), okAgent, state));
    expect(isConflicting).not.toHaveBeenCalled();
  });

  it('checks conflicts and records a failed attempt when enabled', async () => {
    const isConflicting = vi.fn(async () => true);
    const state: State = { lastTickAt: null, repos: {} };
    // clone() makes an empty dir, so the merge blows up — the point is the wiring.
    await tick(makeDeps(fresh({ isConflicting }), okAgent, state, { autoResolveConflicts: true }));
    expect(isConflicting).toHaveBeenCalledWith('a/b', 1);
    expect(state.repos['a/b'].conflictAttempts).toEqual({ '1@sha1': 1 });
  });

  it('re-reviews a PR after the author pushes, scoped to the commits since', async () => {
    const state: State = { lastTickAt: null, repos: {} };
    const pr = mkPr(1, '2026-07-22T00:00:00Z');
    const forge = fakeForge([pr]);
    let prompt = '';
    const agent = { ...okAgent, review: async (o: { prompt: string }) => { prompt = o.prompt; return LONG_REVIEW; } };
    await tick(makeDeps(forge, agent, state));
    pr.headSha = 'sha2';
    await tick(makeDeps(forge, agent, state));
    expect(forge.postComment).toHaveBeenCalledTimes(2);
    expect(prompt).toContain('git diff sha1 HEAD');
    expect(state.repos['a/b'].reviewedHeads).toEqual({ '1': 'sha2' });
  });

  it('records the head the clone actually reviewed, not the stale listing one', async () => {
    const state: State = { lastTickAt: null, repos: {} };
    const forge = fakeForge([mkPr(1, '2026-07-22T00:00:00Z')]);
    forge.clone = async (_r, _p, dir) => { await fs.mkdir(dir, { recursive: true }); return 'sha2'; };
    await tick(makeDeps(forge, okAgent, state));
    expect(state.repos['a/b'].reviewedHeads).toEqual({ '1': 'sha2' });
  });

  it('does not re-review with reReviewOnPush off', async () => {
    const state: State = { lastTickAt: null, repos: {} };
    const pr = mkPr(1, '2026-07-22T00:00:00Z');
    const forge = fakeForge([pr]);
    await tick(makeDeps(forge, okAgent, state, { reReviewOnPush: false }));
    pr.headSha = 'sha2';
    await tick(makeDeps(forge, okAgent, state, { reReviewOnPush: false }));
    expect(forge.postComment).toHaveBeenCalledTimes(1);
  });

  it('upgrading from a SHA-less ledger pins the current head instead of re-reviewing', async () => {
    const state: State = { lastTickAt: null, repos: {} };
    const forge = fakeForge([{ ...mkPr(1, '2026-07-22T00:00:00Z'), headSha: 'sha9' }]);
    const deps = makeDeps(forge, okAgent, state);
    state.repos['a/b'].reviewed = [1];
    await tick(deps);
    expect(forge.postComment).not.toHaveBeenCalled();
    expect(state.repos['a/b'].reviewedHeads).toEqual({ '1': 'sha9' });
  });
});
