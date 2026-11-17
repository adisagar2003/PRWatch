import { describe, it, expect } from 'vitest';
import { cell, fitSegs, gradientAt } from './btop.js';
import { ago, recentReviews, tally } from './data.js';
import type { ReviewRecord } from '../state.js';

const width = (segs: { text: string }[]) => segs.reduce((n, s) => n + [...s.text].length, 0);

describe('text helpers', () => {
  it('pads, clips with an ellipsis, and right-aligns', () => {
    expect(cell('abc', 5)).toBe('abc  ');
    expect(cell('abcdef', 4)).toBe('abc…');
    expect(cell('7', 3, 'right')).toBe('  7');
  });

  it('fits segments to an exact width', () => {
    expect(width(fitSegs([{ text: 'hello' }, { text: 'world' }], 7))).toBe(7);
    expect(width(fitSegs([{ text: 'hi' }], 6))).toBe(6);
  });

  it('interpolates gradients between stops', () => {
    expect(gradientAt(['#000000', '#ffffff'], 0.5)).toBe('#808080');
  });
});

const rec = (o: Partial<ReviewRecord>): ReviewRecord => ({
  repo: 'a/b', pr: 1, title: 't', author: 'x', kind: 'review', at: '2026-01-01T11:00:00Z',
  durationMs: 1000, outcome: 'posted', rereview: false, ...o,
});
const NOW = new Date('2026-01-01T12:00:00Z');

describe('dashboard data', () => {
  it('tallies reviews, re-reviews, conflict fixes and failures', () => {
    expect(tally([rec({}), rec({ rereview: true }), rec({ kind: 'conflict', outcome: 'resolved' }), rec({ outcome: 'failed' })]))
      .toEqual({ reviews: 1, rereviews: 1, resolved: 1, failed: 1 });
  });

  it('lists reviews newest first and leaves out skipped jobs', () => {
    const out = recentReviews([
      rec({ pr: 1, at: '2026-01-01T10:00:00Z' }),
      rec({ pr: 2, at: '2026-01-01T11:00:00Z' }),
      rec({ pr: 3, outcome: 'skipped' }),
    ]);
    expect(out.map((r) => r.pr)).toEqual([2, 1]);
  });

  it('labels ages compactly', () => {
    expect(ago('2026-01-01T11:59:30Z', NOW)).toBe('30s');
    expect(ago('2026-01-01T09:00:00Z', NOW)).toBe('3h');
  });
});
