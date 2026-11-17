import { describe, it, expect } from 'vitest';
import { brailleGraph, cell, fitSegs, gradientAt, meterSegs, segWidth, superscript } from './btop.js';
import { histogram, resample, tally, sortReviews, filterReviews, ago } from './data.js';
import type { ReviewRecord } from '../state.js';

describe('brailleGraph', () => {
  it('is exactly width × height cells', () => {
    const rows = brailleGraph([1, 5, 2, 8], 6, 3);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect([...r]).toHaveLength(6);
  });

  it('fills a full cell for a peak and leaves zeros blank', () => {
    const [row] = brailleGraph([4, 4], 1, 1, { max: 4 });
    expect(row).toBe('⣿');
    expect(brailleGraph([0, 0], 1, 1)).toEqual([' ']);
  });

  it('shows at least one dot for a tiny non-zero value', () => {
    const rows = brailleGraph([1, 0], 1, 2, { max: 1000 });
    expect(rows[1]).not.toBe(' '); // bottom row
    expect(rows[0]).toBe(' ');
  });

  it('grows from the top when mirrored downward', () => {
    const rows = brailleGraph([4, 4], 1, 2, { max: 8, down: true });
    expect(rows[0]).toBe('⣿');
    expect(rows[1]).toBe(' ');
  });

  it('keeps the newest samples on the right when there are too many', () => {
    const [row] = brailleGraph([9, 9, 9, 0, 0], 1, 1);
    expect(row).toBe(' ');
  });
});

describe('text helpers', () => {
  it('pads, clips with an ellipsis, and right-aligns', () => {
    expect(cell('abc', 5)).toBe('abc  ');
    expect(cell('abcdef', 4)).toBe('abc…');
    expect(cell('7', 3, 'right')).toBe('  7');
  });

  it('fits segments to an exact width', () => {
    expect(segWidth(fitSegs([{ text: 'hello' }, { text: 'world' }], 7))).toBe(7);
    expect(segWidth(fitSegs([{ text: 'hi' }], 6))).toBe(6);
  });

  it('writes hotkeys as superscripts', () => {
    expect(superscript(1)).toBe('¹');
    expect(superscript(45)).toBe('⁴⁵');
  });

  it('interpolates gradients between stops', () => {
    expect(gradientAt(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(gradientAt(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(gradientAt(['#000000', '#ffffff'], 0.5)).toBe('#808080');
  });

  it('meters are always width cells and fill proportionally', () => {
    const m = meterSegs(1, 4, 8, ['#ff0000']);
    expect(m).toHaveLength(8);
    expect(m.filter((s) => s.color === '#ff0000')).toHaveLength(2);
  });
});

const rec = (o: Partial<ReviewRecord>): ReviewRecord => ({
  repo: 'a/b', pr: 1, title: 't', author: 'x', kind: 'review', at: '2026-01-01T11:00:00Z',
  durationMs: 1000, outcome: 'posted', rereview: false, ...o,
});
const NOW = new Date('2026-01-01T12:00:00Z');

describe('dashboard data', () => {
  it('buckets records into the window, oldest first, ignoring older ones', () => {
    const h = [
      rec({ at: '2026-01-01T11:59:00Z' }),
      rec({ at: '2026-01-01T11:01:00Z' }),
      rec({ at: '2025-12-31T00:00:00Z' }),
    ];
    expect(histogram(h, NOW, 3_600_000, 4, () => 1)).toEqual([1, 0, 0, 1]);
  });

  it('resamples a series to any length by interpolation', () => {
    expect(resample([0, 4], 5)).toEqual([0, 1, 2, 3, 4]);
    expect(resample([], 3)).toEqual([0, 0, 0]);
  });

  it('tallies first reviews, re-reviews, conflict fixes and failures', () => {
    const t = tally([
      rec({ durationMs: 2000 }),
      rec({ rereview: true, durationMs: 4000 }),
      rec({ kind: 'conflict', outcome: 'resolved' }),
      rec({ outcome: 'failed' }),
    ]);
    expect(t).toMatchObject({ reviews: 1, rereviews: 1, resolved: 1, failed: 1, avgMs: 3000 });
  });

  it('sorts by time taken, slowest first', () => {
    const out = sortReviews([rec({ pr: 1, durationMs: 5 }), rec({ pr: 2, durationMs: 50 })], 'took');
    expect(out.map((r) => r.pr)).toEqual([2, 1]);
  });

  it('filters on repo#pr, title, author and outcome', () => {
    const list = [rec({ pr: 7, title: 'Add webhook' }), rec({ pr: 8, author: 'eve', outcome: 'failed' })];
    expect(filterReviews(list, '#7')).toHaveLength(1);
    expect(filterReviews(list, 'EVE')).toHaveLength(1);
    expect(filterReviews(list, 'failed')).toHaveLength(1);
    expect(filterReviews(list, '')).toHaveLength(2);
  });

  it('labels ages compactly', () => {
    expect(ago('2026-01-01T11:59:30Z', NOW)).toBe('30s');
    expect(ago('2026-01-01T09:00:00Z', NOW)).toBe('3h');
  });
});
