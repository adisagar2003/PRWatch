import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, ensureRepoState, recordReviewed, recordFailure, MAX_ATTEMPTS } from './state.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('state', () => {
  it('loads empty state when no file exists', async () => {
    expect(await loadState()).toEqual({ lastTickAt: null, repos: {} });
  });

  it('round-trips through disk', async () => {
    const s = await loadState();
    ensureRepoState(s, 'a/b', new Date('2026-07-21T00:00:00Z'));
    await saveState(s);
    expect(await loadState()).toEqual(s);
  });

  it('ensureRepoState sets the watch cursor once and keeps it', () => {
    const s = { lastTickAt: null, repos: {} };
    const rs = ensureRepoState(s, 'a/b', new Date('2026-07-21T00:00:00Z'));
    expect(rs.watchStartedAt).toBe('2026-07-21T00:00:00.000Z');
    const again = ensureRepoState(s, 'a/b', new Date('2027-01-01T00:00:00Z'));
    expect(again.watchStartedAt).toBe('2026-07-21T00:00:00.000Z');
  });

  it('recordReviewed adds to ledger and clears retries', () => {
    const s = { lastTickAt: null, repos: {} };
    const rs = ensureRepoState(s, 'a/b', new Date());
    rs.retries['7'] = 1;
    recordReviewed(rs, 7);
    expect(rs.reviewed).toEqual([7]);
    expect(rs.retries['7']).toBeUndefined();
  });

  it('recordFailure retries then gives up at MAX_ATTEMPTS', () => {
    const s = { lastTickAt: null, repos: {} };
    const rs = ensureRepoState(s, 'a/b', new Date());
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      recordFailure(rs, 9);
      expect(rs.failed).toEqual([]);
    }
    recordFailure(rs, 9); // third attempt
    expect(rs.failed).toEqual([9]);
    expect(rs.retries['9']).toBeUndefined();
  });

  it('throws on corrupt JSON with state path in error message', async () => {
    // Write corrupt JSON to state.json in PRWATCH_HOME (which is tmp)
    await fs.writeFile(path.join(tmp, 'state.json'), '{invalid json}');

    await expect(loadState()).rejects.toThrow(/invalid state at.*state\.json/);
  });
});
