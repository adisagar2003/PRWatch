import { describe, it, expect } from 'vitest';
import { parseLog, reviewHistogram } from './log.js';

const LINES = [
  '[2026-08-18T00:05:00.000Z] reviewing a/b#1 "T" with claude',
  '[2026-08-18T00:06:00.000Z] posted review for a/b#1',
  '[2026-08-18T00:25:00.000Z] posted review for a/b#2',
  '[2026-08-18T00:26:00.000Z] could not list PRs for a/b: gh exited 1',
  'check your internet connection', // wrapped continuation of the line above
];

describe('parseLog', () => {
  it('pairs each timestamped line with its message', () => {
    const entries = parseLog(LINES);
    expect(entries[1].text).toBe('posted review for a/b#1');
    expect(entries[1].at.toISOString()).toBe('2026-08-18T00:06:00.000Z');
  });

  it('drops wrapped continuation lines that carry no timestamp', () => {
    expect(parseLog(LINES)).toHaveLength(4);
  });
});

describe('reviewHistogram', () => {
  const now = new Date('2026-08-18T00:30:00.000Z');
  const TEN_MIN = 600_000;

  it('buckets posted reviews oldest-first across the window', () => {
    expect(reviewHistogram(parseLog(LINES), now, TEN_MIN, 3)).toEqual([1, 0, 1]);
  });

  it('counts only posted reviews, not every log line', () => {
    const noisy = parseLog(['[2026-08-18T00:25:00.000Z] reviewing a/b#9 "T" with claude']);
    expect(reviewHistogram(noisy, now, TEN_MIN, 3)).toEqual([0, 0, 0]);
  });

  it('ignores entries older than the window', () => {
    const old = parseLog(['[2026-08-17T00:00:00.000Z] posted review for a/b#1']);
    expect(reviewHistogram(old, now, TEN_MIN, 3)).toEqual([0, 0, 0]);
  });
});
