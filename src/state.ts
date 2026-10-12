import fs from 'node:fs/promises';
import { statePath, prwatchHome } from './paths.js';
import type { PR } from './forge/types.js';

export interface RepoState {
  watchStartedAt: string;
  reviewed: number[];
  failed: number[];
  retries: Record<string, number>;
  /** Failed conflict-resolution attempts, keyed `<pr>@<headSha>`, so we stop retrying forever. */
  conflictAttempts?: Record<string, number>;
  /** Head SHA the last posted review covered, keyed by PR number. A newer head earns a re-review. */
  reviewedHeads?: Record<string, string>;
  /** Chat: comments are listed from this ISO time on; unset = chat hasn't started for this repo. */
  chatSince?: string;
  /** Chat: highest comment id already handled, so re-listed comments aren't answered twice. */
  chatCursor?: number;
}

export interface State {
  lastTickAt: string | null;
  repos: Record<string, RepoState>;
}

export const MAX_ATTEMPTS = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateState(parsed: unknown): State {
  if (!isPlainObject(parsed)) {
    throw new Error('state must be an object');
  }
  if (typeof parsed.lastTickAt !== 'string' && parsed.lastTickAt !== null) {
    throw new Error('lastTickAt must be a string or null');
  }
  if (!isPlainObject(parsed.repos)) {
    throw new Error('repos must be an object');
  }
  return parsed as unknown as State;
}

export async function loadState(): Promise<State> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    return validateState(raw);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { lastTickAt: null, repos: {} };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid state at ${statePath()}: ${message}`);
  }
}

export async function saveState(s: State): Promise<void> {
  await fs.mkdir(prwatchHome(), { recursive: true });
  const target = statePath();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2) + '\n');
  await fs.rename(tmp, target);
}

export function ensureRepoState(s: State, repo: string, now: Date): RepoState {
  s.repos[repo] ??= {
    watchStartedAt: now.toISOString(),
    reviewed: [],
    failed: [],
    retries: {},
  };
  return s.repos[repo];
}

export function recordReviewed(rs: RepoState, pr: number, headSha?: string): void {
  if (!rs.reviewed.includes(pr)) rs.reviewed.push(pr);
  delete rs.retries[String(pr)];
  if (headSha !== undefined) (rs.reviewedHeads ??= {})[String(pr)] = headSha;
}

/** Reviews recorded before SHAs were tracked count as covering today's head, so upgrading doesn't re-review everything. */
export function backfillReviewedHeads(rs: RepoState, open: PR[]): void {
  for (const pr of open) {
    if (!rs.reviewed.includes(pr.number)) continue;
    rs.reviewedHeads ??= {};
    rs.reviewedHeads[String(pr.number)] ??= pr.headSha;
  }
}

/** prwatch's own conflict-merge commit isn't new work: move the reviewed head along with it. */
export function markOwnPush(rs: RepoState, pr: number, before: string, after: string): void {
  if (rs.reviewedHeads?.[String(pr)] === before) rs.reviewedHeads[String(pr)] = after;
}

const attemptKey = (pr: number, headSha: string) => `${pr}@${headSha}`;

export function conflictAttemptsLeft(rs: RepoState, pr: number, headSha: string): boolean {
  return (rs.conflictAttempts?.[attemptKey(pr, headSha)] ?? 0) < MAX_ATTEMPTS;
}

export function recordConflictFailure(rs: RepoState, pr: number, headSha: string): void {
  const key = attemptKey(pr, headSha);
  rs.conflictAttempts ??= {};
  rs.conflictAttempts[key] = (rs.conflictAttempts[key] ?? 0) + 1;
}

/** Drop counters for PRs that closed or moved on, so state.json doesn't grow forever. */
export function pruneConflictAttempts(rs: RepoState, open: PR[]): void {
  if (!rs.conflictAttempts) return;
  const live = new Set(open.map((pr) => attemptKey(pr.number, pr.headSha)));
  for (const key of Object.keys(rs.conflictAttempts)) {
    if (!live.has(key)) delete rs.conflictAttempts[key];
  }
}

export function recordFailure(rs: RepoState, pr: number): void {
  const attempts = (rs.retries[String(pr)] ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    if (!rs.failed.includes(pr)) rs.failed.push(pr);
    delete rs.retries[String(pr)];
  } else {
    rs.retries[String(pr)] = attempts;
  }
}
