import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadState, saveState, ensureRepoState, recordReviewed, backfillReviewedHeads, markOwnPush, recordFailure, MAX_ATTEMPTS,
  conflictAttemptsLeft, recordConflictFailure, pruneConflictAttempts, type RepoState,
} from './state.js';
import type { PR } from './forge/types.js';

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

  it('recordReviewed remembers the head SHA the review covered', () => {
    const rs = ensureRepoState({ lastTickAt: null, repos: {} }, 'a/b', new Date());
    recordReviewed(rs, 7, 'sha1');
    expect(rs.reviewedHeads).toEqual({ '7': 'sha1' });
  });

  it('backfillReviewedHeads pins legacy reviews to the current head, without overwriting', () => {
    const rs = ensureRepoState({ lastTickAt: null, repos: {} }, 'a/b', new Date());
    rs.reviewed = [1, 2];
    rs.reviewedHeads = { '2': 'old' };
    const open = (n: number, headSha: string) => ({ number: n, headSha }) as PR;
    backfillReviewedHeads(rs, [open(1, 'cur1'), open(2, 'cur2'), open(3, 'cur3')]);
    expect(rs.reviewedHeads).toEqual({ '1': 'cur1', '2': 'old' });
  });

  it('markOwnPush advances the reviewed head only if the review covered the pre-push head', () => {
    const rs = ensureRepoState({ lastTickAt: null, repos: {} }, 'a/b', new Date());
    rs.reviewedHeads = { '1': 'before', '2': 'older' };
    markOwnPush(rs, 1, 'before', 'merge1');
    markOwnPush(rs, 2, 'before', 'merge2');
    expect(rs.reviewedHeads).toEqual({ '1': 'merge1', '2': 'older' });
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

  it('rejects state.json with valid JSON but wrong shape', async () => {
    await fs.writeFile(path.join(tmp, 'state.json'), '{}');
    await expect(loadState()).rejects.toThrow(/invalid state/);
  });

  it('writes atomically: no leftover .tmp file, content round-trips', async () => {
    const s = { lastTickAt: '2026-07-21T00:00:00.000Z', repos: {} };
    await saveState(s);
    const entries = await fs.readdir(tmp);
    expect(entries).toContain('state.json');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
    expect(await loadState()).toEqual(s);
  });

  describe('conflict attempts', () => {
    const rs = (): RepoState =>
      ({ watchStartedAt: '2026-07-21T00:00:00.000Z', reviewed: [], failed: [], retries: {} });
    const pr = (number: number, headSha: string) => ({ number, headSha }) as PR;

    it('gives up after MAX_ATTEMPTS on one head SHA', () => {
      const s = rs();
      for (let i = 0; i < MAX_ATTEMPTS; i++) recordConflictFailure(s, 1, 'sha1');
      expect(conflictAttemptsLeft(s, 1, 'sha1')).toBe(false);
    });

    it('a new head SHA earns a fresh attempt budget', () => {
      const s = rs();
      for (let i = 0; i < MAX_ATTEMPTS; i++) recordConflictFailure(s, 1, 'sha1');
      expect(conflictAttemptsLeft(s, 1, 'sha2')).toBe(true);
    });

    it('prunes counters for PRs and SHAs that are no longer open', () => {
      const s = rs();
      recordConflictFailure(s, 1, 'sha1'); // still open, same SHA — kept
      recordConflictFailure(s, 1, 'old');  // superseded SHA — dropped
      recordConflictFailure(s, 2, 'sha2'); // PR closed — dropped
      pruneConflictAttempts(s, [pr(1, 'sha1')]);
      expect(s.conflictAttempts).toEqual({ '1@sha1': 1 });
    });
  });
});
