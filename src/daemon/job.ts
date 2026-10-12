import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import { resolveRubric } from '../rubric.js';
import { buildPrompt, reReviewNote } from '../prompt.js';
import { MARKER, headMarker } from '../forge/github.js';

export type JobResult = 'posted' | 'skipped-existing' | 'skipped-closed' | 'failed';

export interface JobDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  cacheRoot: string;
  timeoutMs: number;
  log: (msg: string) => void;
  /** Called with the head the clone actually has — newer than the listing if the author just pushed. */
  onReviewedHead?: (sha: string) => void;
}

const MIN_OUTPUT_CHARS = 50;

const PRWATCH_URL = 'https://github.com/adisagar2003/PRWatch';

function attribution(agentName: string): string {
  return `\n\n---\n👁️🌀 *By [PRWatch](${PRWATCH_URL}) · reviewed with \`${agentName}\`*`;
}

/** sinceSha set = re-review: only the commits after the head the previous review covered. */
export async function runReviewJob(
  deps: JobDeps, repo: string, pr: PR, sinceSha?: string,
): Promise<JobResult> {
  const { forge, agent, cacheRoot, timeoutMs, log } = deps;

  const dir = path.join(cacheRoot, `${repo.replace('/', '-')}-${pr.number}`);

  try {
    if (!(await forge.isOpen(repo, pr.number))) {
      log(`skip ${repo}#${pr.number}: no longer open`);
      return 'skipped-closed';
    }

    const existing = sinceSha === undefined ? MARKER : headMarker(pr.headSha);
    if (await forge.hasMarkerComment(repo, pr.number, existing)) {
      log(`skip ${repo}#${pr.number}: prwatch comment already exists`);
      return 'skipped-existing';
    }

    await fs.mkdir(cacheRoot, { recursive: true });

    log(`reviewing ${repo}#${pr.number} "${pr.title}" with ${agent.name}`);
    // The author may have pushed since the listing; review and stamp what we actually cloned.
    const head = await forge.clone(repo, pr.number, dir);
    deps.onReviewedHead?.(head);
    if (head === sinceSha) {
      log(`skip ${repo}#${pr.number}: no new commits since ${sinceSha.slice(0, 7)}`);
      return 'skipped-existing';
    }
    if (sinceSha !== undefined && head !== pr.headSha
      && await forge.hasMarkerComment(repo, pr.number, headMarker(head))) {
      log(`skip ${repo}#${pr.number}: prwatch comment already exists`);
      return 'skipped-existing';
    }
    const rubric = await resolveRubric(dir);
    const prompt = buildPrompt(rubric, repo, pr) + (sinceSha ? reReviewNote(sinceSha) : '');
    const output = (await agent.review({ cwd: dir, prompt, timeoutMs })).trim();
    if (output.length < MIN_OUTPUT_CHARS) {
      throw new Error(`agent output too short (${output.length} chars)`);
    }
    if (!(await forge.isOpen(repo, pr.number))) {
      log(`skip ${repo}#${pr.number}: closed or merged while the review ran`);
      return 'skipped-closed';
    }
    const heading = sinceSha ? `**🔁 Re-review** — changes since \`${sinceSha.slice(0, 7)}\`\n\n` : '';
    await forge.postComment(
      repo, pr.number,
      `${MARKER}\n${headMarker(head)}\n${heading}${output}${attribution(agent.name)}`,
    );
    log(`posted review for ${repo}#${pr.number}${sinceSha ? ` (re-review since ${sinceSha.slice(0, 7)})` : ''}`);
    return 'posted';
  } catch (e) {
    log(`FAILED ${repo}#${pr.number}: ${(e as Error).message}`);
    return 'failed';
  } finally {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e) {
      log(`cleanup failed for ${dir}: ${(e as Error).message}`);
    }
  }
}
