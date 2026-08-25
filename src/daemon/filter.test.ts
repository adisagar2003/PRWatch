import { describe, it, expect } from 'vitest';
import { prsNeedingReview, prsNeedingConflictCheck } from './filter.js';
import type { PR } from '../forge/types.js';
import type { RepoState } from '../state.js';

const pr = (number: number, createdAt: string): PR => ({
  number, createdAt, title: 't', body: '', headRef: 'branch', headSha: 'sha1', baseRef: 'main',
  fromFork: false, author: 'adi',
});

const rs = (over: Partial<RepoState> = {}): RepoState => ({
  watchStartedAt: '2026-07-21T00:00:00.000Z',
  reviewed: [], failed: [], retries: {},
  ...over,
});

describe('prsNeedingReview', () => {
  it('excludes PRs created before watching started', () => {
    const prs = [pr(1, '2026-07-20T00:00:00Z'), pr(2, '2026-07-22T00:00:00Z')];
    expect(prsNeedingReview(prs, rs()).map(p => p.number)).toEqual([2]);
  });

  it('excludes already-reviewed and permanently-failed PRs', () => {
    const prs = [pr(3, '2026-07-22T00:00:00Z'), pr(4, '2026-07-22T00:00:00Z'), pr(5, '2026-07-22T00:00:00Z')];
    expect(prsNeedingReview(prs, rs({ reviewed: [3], failed: [4] })).map(p => p.number)).toEqual([5]);
  });

  it('keeps PRs with pending retries', () => {
    const prs = [pr(6, '2026-07-22T00:00:00Z')];
    expect(prsNeedingReview(prs, rs({ retries: { '6': 1 } })).map(p => p.number)).toEqual([6]);
  });
});

describe('prsNeedingConflictCheck', () => {
  it('keeps reviewed and failed PRs — conflicts appear long after the review', () => {
    const prs = [pr(1, '2026-07-22T00:00:00Z'), pr(2, '2026-07-22T00:00:00Z')];
    const state = rs({ reviewed: [1], failed: [2] });
    expect(prsNeedingConflictCheck(prs, state).map(p => p.number)).toEqual([1, 2]);
  });

  it('drops a PR we gave up on, but not once the author pushes a new head', () => {
    const prs = [pr(1, '2026-07-22T00:00:00Z')];
    expect(prsNeedingConflictCheck(prs, rs({ conflictAttempts: { '1@sha1': 3 } }))).toEqual([]);
    expect(prsNeedingConflictCheck(prs, rs({ conflictAttempts: { '1@older': 3 } })).map(p => p.number))
      .toEqual([1]);
  });
});
