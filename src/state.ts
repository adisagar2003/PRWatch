import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { statePath, prwatchHome } from './paths.js';

export interface RepoState {
  watchStartedAt: string;
  reviewed: number[];
  failed: number[];
  retries: Record<string, number>;
}

export interface CurrentJob {
  repo: string;
  pr: number;
  agent: string;
  startedAt: string;
}

export interface State {
  lastTickAt: string | null;
  repos: Record<string, RepoState>;
  /** The review the daemon is running right now; null/absent when idle. */
  currentJob?: CurrentJob | null;
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
  if (parsed.currentJob !== undefined && parsed.currentJob !== null) {
    if (!isPlainObject(parsed.currentJob)) {
      throw new Error('currentJob must be an object or null');
    }
    const cj = parsed.currentJob;
    if (typeof cj.repo !== 'string') throw new Error('currentJob.repo must be a string');
    if (typeof cj.pr !== 'number') throw new Error('currentJob.pr must be a number');
    if (typeof cj.agent !== 'string') throw new Error('currentJob.agent must be a string');
    if (typeof cj.startedAt !== 'string') throw new Error('currentJob.startedAt must be a string');
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

/** Heal a currentJob left behind by a crash — call on daemon startup. */
export async function clearStaleCurrentJob(): Promise<void> {
  const s = await loadState();
  if (s.currentJob) {
    s.currentJob = null;
    await saveState(s);
  }
}

/** Signal-handler-safe variant: best-effort, synchronous, never throws. */
export function clearCurrentJobSync(): void {
  try {
    const target = statePath();
    const s = JSON.parse(fsSync.readFileSync(target, 'utf8')) as Record<string, unknown>;
    if (!isPlainObject(s) || s.currentJob == null) return;
    s.currentJob = null;
    const tmp = `${target}.tmp`;
    fsSync.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    fsSync.renameSync(tmp, target);
  } catch {
    // best effort during shutdown — never block the exit path
  }
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

export function recordReviewed(rs: RepoState, pr: number): void {
  if (!rs.reviewed.includes(pr)) rs.reviewed.push(pr);
  delete rs.retries[String(pr)];
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
