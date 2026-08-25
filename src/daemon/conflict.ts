import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import { buildConflictPrompt } from '../prompt.js';
import {
  mergeBase, unmergedPaths, hasConflictMarkers, stageAll, commitMerge, pushBranch,
} from './git.js';

export type ConflictResult = 'resolved' | 'skipped' | 'failed';

export interface ConflictDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  cacheRoot: string;
  timeoutMs: number;
  log: (msg: string) => void;
}

/** Merge the base branch into the PR branch, have the agent fix conflicts, push the result. */
export async function runConflictJob(
  deps: ConflictDeps,
  repo: string,
  pr: PR,
): Promise<ConflictResult> {
  const { forge, agent, cacheRoot, timeoutMs, log } = deps;

  if (pr.fromFork) {
    log(`skip conflicts ${repo}#${pr.number}: PR is from a fork`);
    return 'skipped';
  }

  const dir = path.join(cacheRoot, `${repo.replace('/', '-')}-${pr.number}-merge`);
  try {
    if (!(await forge.isConflicting(repo, pr.number))) return 'skipped';

    log(`resolving conflicts in ${repo}#${pr.number} with ${agent.name}`);
    await fs.mkdir(cacheRoot, { recursive: true });
    await forge.clone(repo, pr.number, dir);

    if ((await mergeBase(dir, pr.baseRef)) === 'clean') {
      log(`skip conflicts ${repo}#${pr.number}: base merged cleanly`);
      return 'skipped';
    }

    const files = await unmergedPaths(dir);
    await agent.review({
      cwd: dir, prompt: buildConflictPrompt(repo, pr, files), timeoutMs, write: true,
    });

    if (await hasConflictMarkers(dir, files)) {
      throw new Error('conflict markers remain after the agent ran');
    }
    // Staging is what marks a conflict resolved; the agent only edits files.
    await stageAll(dir);
    if ((await unmergedPaths(dir)).length > 0) {
      throw new Error('git still reports unresolved paths');
    }

    await commitMerge(dir);
    await pushBranch(dir, pr.headRef);
    log(`pushed conflict resolution for ${repo}#${pr.number}`);
    return 'resolved';
  } catch (e) {
    log(`CONFLICT FAILED ${repo}#${pr.number}: ${(e as Error).message}`);
    return 'failed';
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
