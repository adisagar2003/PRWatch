import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tick } from './loop.js';
import { ensureRepoState, type State } from '../state.js';
import { DEFAULT_CONFIG } from '../config.js';
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
  number: n, title: `PR ${n}`, body: '', createdAt, headRef: 'b', author: 'adi',
});

function fakeForge(prs: PR[]): ForgeAdapter {
  return {
    name: 'fake',
    listOpenPRs: async () => prs,
    isOpen: async () => true,
    clone: async (_r, _p, dir) => { await fs.mkdir(dir, { recursive: true }); },
    hasMarkerComment: async () => false,
    postComment: vi.fn(async () => {}),
  };
}

const okAgent: AgentAdapter = { name: 'claude', isInstalled: async () => true, review: async () => LONG_REVIEW };

function makeDeps(forge: ForgeAdapter, agent: AgentAdapter, state: State) {
  ensureRepoState(state, 'a/b', new Date('2026-07-21T00:00:00Z'));
  return {
    forge, agent, state,
    config: { ...DEFAULT_CONFIG, repos: ['a/b'] },
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
});
