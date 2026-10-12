// Thin git helpers for the conflict job (conflict.ts is the only caller): merge the
// base branch into a PR checkout, find what is still unresolved, and commit/push the
// result. Every command takes an injectable `git` so tests can fake or record it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../run-command.js';

export type Git = (args: string[], cwd: string) => Promise<string>;

const GIT_TIMEOUT_MS = 120_000;

/** Merging needs a committer identity, and a fresh machine (CI, a Linux service) may have none. */
const IDENTITY = ['-c', 'user.name=PRWatch', '-c', 'user.email=prwatch@users.noreply.github.com'];

export const defaultGit: Git = (args, cwd) =>
  runCommand('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS });

/**
 * Merge origin/<baseRef> into the checked-out branch.
 * 'clean' = merged or already up to date; 'conflicted' = conflicts left in the worktree.
 */
export async function mergeBase(
  dir: string,
  baseRef: string,
  git: Git = defaultGit,
): Promise<'clean' | 'conflicted'> {
  // The PR checkout is shallow, so the merge base is usually missing from history.
  await git(['fetch', '--unshallow', 'origin'], dir).catch(() => '' /* already complete */);
  await git(['fetch', 'origin', `${baseRef}:refs/remotes/origin/${baseRef}`], dir);
  try {
    await git([...IDENTITY, 'merge', '--no-edit', `origin/${baseRef}`], dir);
    return 'clean';
  } catch (e) {
    if ((await unmergedPaths(dir, git)).length > 0) return 'conflicted';
    throw e;
  }
}

/** Files git still considers unresolved. */
export async function unmergedPaths(dir: string, git: Git = defaultGit): Promise<string[]> {
  const out = await git(['diff', '--name-only', '--diff-filter=U'], dir);
  return out.split('\n').filter((l) => l.trim() !== '');
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/** The agent claiming success isn't proof — check the files it touched. */
export async function hasConflictMarkers(dir: string, paths: string[]): Promise<boolean> {
  for (const p of paths) {
    const text = await fs.readFile(path.join(dir, p), 'utf8').catch(() => '');
    if (CONFLICT_MARKER.test(text)) return true;
  }
  return false;
}

/**
 * Paths the agent changed besides `allowed` (the conflicted files): unstaged edits and
 * new files. Merge-staged files only show up here if the agent touched them afterwards.
 */
export async function changedOutside(
  dir: string,
  allowed: string[],
  git: Git = defaultGit,
): Promise<string[]> {
  const out = [
    await git(['diff', '--name-only'], dir),
    await git(['ls-files', '--others', '--exclude-standard'], dir),
  ].join('\n');
  const ok = new Set(allowed);
  return out.split('\n').filter((l) => l.trim() !== '' && !ok.has(l));
}

export async function stageAll(dir: string, git: Git = defaultGit): Promise<void> {
  await git(['add', '-A'], dir);
}

export async function commitMerge(dir: string, git: Git = defaultGit): Promise<void> {
  await git([...IDENTITY, 'commit', '--no-edit'], dir);
}

export async function pushBranch(dir: string, headRef: string, git: Git = defaultGit): Promise<void> {
  await git(['push', 'origin', `HEAD:refs/heads/${headRef}`], dir);
}
