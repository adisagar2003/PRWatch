import fs from 'node:fs/promises';
import { statePath, prwatchHome } from './paths.js';

export interface RepoState {
  watchStartedAt: string;
  reviewed: number[];
  failed: number[];
  retries: Record<string, number>;
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
