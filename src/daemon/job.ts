import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import type { ReviewProfile } from '../config.js';
import { resolveRubric } from '../rubric.js';
import { buildPrompt, reReviewNote, lineCommentsNote } from '../prompt.js';
import { resolveLearnings } from '../learnings.js';
import { splitReview, commentableLines, keepInDiff, formatCommentBody, type AgentLineComment } from '../review-comments.js';
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
  profile?: ReviewProfile;
  lineComments?: boolean;
}

const MIN_OUTPUT_CHARS = 50;

export const PRWATCH_URL = 'https://github.com/adisagar2003/PRWatch';

function attribution(agentName: string): string {
  return `\n\n---\n👁️🌀 *By [PRWatch](${PRWATCH_URL}) · reviewed with \`${agentName}\`*`;
}

/** Best effort: the summary is already up, so a failure here is logged, never retried (no duplicates). */
async function postLineComments(
  forge: ForgeAdapter, repo: string, pr: PR, head: string,
  comments: AgentLineComment[], log: (msg: string) => void,
): Promise<void> {
  const where = `${repo}#${pr.number}`;
  try {
    // Diff and post against the cloned head, so lines match what the agent read even after a push.
    const diff = commentableLines(await forge.getDiff(repo, pr.baseRef, head));
    const { kept, dropped } = keepInDiff(comments, diff);
    if (dropped > 0) log(`${where}: dropped ${dropped} line comment(s) outside the diff`);
    if (kept.length === 0) return;
    await forge.postLineComments(
      repo, pr.number,
      kept.map((c) => ({ path: c.path, line: c.line, startLine: c.startLine, body: formatCommentBody(c) })),
      head,
    );
    log(`posted ${kept.length} line comment(s) for ${where}`);
  } catch (e) {
    log(`line comments failed for ${where}: ${(e as Error).message}`);
  }
}

/** sinceSha set = re-review: only the commits after the head the previous review covered. */
export async function runReviewJob(
  deps: JobDeps, repo: string, pr: PR, sinceSha?: string,
): Promise<JobResult> {
  const { forge, agent, cacheRoot, timeoutMs, log, profile, lineComments = false } = deps;

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
    const prompt = buildPrompt(rubric, repo, pr, profile, await resolveLearnings(dir)) + (sinceSha ? reReviewNote(sinceSha) : '')
      + (lineComments ? lineCommentsNote() : '');
    const raw = (await agent.review({ cwd: dir, prompt, timeoutMs })).trim();
    const { summary: output, comments, error } = splitReview(raw);
    if (error) log(`${repo}#${pr.number}: ${error}`);
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
    if (lineComments && comments.length > 0) {
      await postLineComments(forge, repo, pr, head, comments, log);
    }
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
