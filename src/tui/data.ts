// Pure data shaping for the dashboard: windows, histograms, sorting, filtering.
import type { ReviewRecord } from '../state.js';

/** Graph windows; `buckets` sets the time resolution (1h → 2.5m, 24h → 30m, …). */
export const WINDOWS = [
  { label: '1h', ms: 3_600_000, buckets: 24 },
  { label: '6h', ms: 6 * 3_600_000, buckets: 36 },
  { label: '24h', ms: 24 * 3_600_000, buckets: 48 },
  { label: '7d', ms: 7 * 24 * 3_600_000, buckets: 56 },
] as const;

export const SORTS = ['time', 'repo', 'took'] as const;
export type SortKey = (typeof SORTS)[number];

/** Sum of `pick(rec)` per bucket across [now - windowMs, now], oldest bucket first. */
export function histogram(
  history: ReviewRecord[],
  now: Date,
  windowMs: number,
  buckets: number,
  pick: (r: ReviewRecord) => number,
): number[] {
  const counts = new Array<number>(Math.max(0, buckets)).fill(0);
  if (buckets <= 0) return counts;
  const start = now.getTime() - windowMs;
  const size = windowMs / buckets;
  for (const r of history) {
    const i = Math.floor((Date.parse(r.at) - start) / size);
    if (i >= 0 && i < buckets) counts[i] += pick(r);
  }
  return counts;
}

/** Stretch `counts` to `samples` points by linear interpolation, so sparse events draw as an area, not hairlines. */
export function resample(counts: number[], samples: number): number[] {
  if (samples <= 0 || counts.length === 0) return new Array<number>(Math.max(0, samples)).fill(0);
  if (counts.length === 1) return new Array<number>(samples).fill(counts[0]);
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const x = samples === 1 ? 0 : (i / (samples - 1)) * (counts.length - 1);
    const a = Math.floor(x);
    const b = Math.min(counts.length - 1, a + 1);
    out.push(counts[a] + (counts[b] - counts[a]) * (x - a));
  }
  return out;
}

export function inWindow(history: ReviewRecord[], now: Date, windowMs: number): ReviewRecord[] {
  const start = now.getTime() - windowMs;
  return history.filter((r) => Date.parse(r.at) >= start);
}

export interface Tally {
  reviews: number;
  rereviews: number;
  resolved: number;
  failed: number;
  avgMs: number;
}

export function tally(records: ReviewRecord[]): Tally {
  const t: Tally = { reviews: 0, rereviews: 0, resolved: 0, failed: 0, avgMs: 0 };
  let total = 0;
  let n = 0;
  for (const r of records) {
    if (r.outcome === 'failed') t.failed++;
    else if (r.outcome === 'resolved') t.resolved++;
    else if (r.outcome === 'posted') {
      if (r.rereview) t.rereviews++;
      else t.reviews++;
      total += r.durationMs;
      n++;
    }
  }
  t.avgMs = n === 0 ? 0 : total / n;
  return t;
}

export function sortReviews(list: ReviewRecord[], by: SortKey): ReviewRecord[] {
  const out = [...list];
  const newest = (a: ReviewRecord, b: ReviewRecord) => Date.parse(b.at) - Date.parse(a.at);
  if (by === 'time') out.sort(newest);
  else if (by === 'took') out.sort((a, b) => b.durationMs - a.durationMs || newest(a, b));
  else out.sort((a, b) => a.repo.localeCompare(b.repo) || b.pr - a.pr || newest(a, b));
  return out;
}

/** Case-insensitive match on repo#pr, title, author and outcome. */
export function filterReviews(list: ReviewRecord[], q: string): ReviewRecord[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return list;
  return list.filter((r) =>
    `${r.repo}#${r.pr} ${r.title} ${r.author} ${r.outcome} ${r.kind}`.toLowerCase().includes(needle),
  );
}

/** Most recent record per repo. */
export function lastByRepo(history: ReviewRecord[]): Record<string, ReviewRecord> {
  const out: Record<string, ReviewRecord> = {};
  for (const r of history) if (!out[r.repo] || Date.parse(r.at) >= Date.parse(out[r.repo].at)) out[r.repo] = r;
  return out;
}

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
