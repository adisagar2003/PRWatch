// Pure data shaping for the dashboard.
import type { ReviewRecord } from '../state.js';

export const DAY_MS = 24 * 3_600_000;

export function inWindow(history: ReviewRecord[], now: Date, windowMs: number): ReviewRecord[] {
  const start = now.getTime() - windowMs;
  return history.filter((r) => Date.parse(r.at) >= start);
}

export interface Tally {
  reviews: number;
  rereviews: number;
  resolved: number;
  failed: number;
}

export function tally(records: ReviewRecord[]): Tally {
  const t: Tally = { reviews: 0, rereviews: 0, resolved: 0, failed: 0 };
  for (const r of records) {
    if (r.outcome === 'failed') t.failed++;
    else if (r.outcome === 'resolved') t.resolved++;
    else if (r.outcome === 'posted') {
      if (r.rereview) t.rereviews++;
      else t.reviews++;
    }
  }
  return t;
}

/** Finished reviews, newest first; skipped jobs aren't worth a row. */
export const recentReviews = (history: ReviewRecord[]): ReviewRecord[] =>
  history.filter((r) => r.outcome !== 'skipped').sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

export function ago(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
}

export const prUrl = (repo: string, pr: number) => `https://github.com/${repo}/pull/${pr}`;
