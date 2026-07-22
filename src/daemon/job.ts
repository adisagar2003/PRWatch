import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import { resolveRubric } from '../rubric.js';
import { buildPrompt } from '../prompt.js';
import { MARKER } from '../forge/github.js';

export type JobResult = 'posted' | 'skipped-existing' | 'failed';

export interface JobDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  cacheRoot: string;
  timeoutMs: number;
  log: (msg: string) => void;
}

const MIN_OUTPUT_CHARS = 50;

export async function runReviewJob(deps: JobDeps, repo: string, pr: PR): Promise<JobResult> {
  const { forge, agent, cacheRoot, timeoutMs, log } = deps;

  if (await forge.hasMarkerComment(repo, pr.number)) {
    log(`skip ${repo}#${pr.number}: prwatch comment already exists`);
    return 'skipped-existing';
  }

  const dir = path.join(cacheRoot, `${repo.replace('/', '-')}-${pr.number}`);
  await fs.mkdir(cacheRoot, { recursive: true });

  try {
    log(`reviewing ${repo}#${pr.number} "${pr.title}" with ${agent.name}`);
    await forge.clone(repo, pr.number, dir);
    const rubric = await resolveRubric(dir);
    const prompt = buildPrompt(rubric, repo, pr);
    const output = (await agent.review({ cwd: dir, prompt, timeoutMs })).trim();
    if (output.length < MIN_OUTPUT_CHARS) {
      throw new Error(`agent output too short (${output.length} chars)`);
    }
    await forge.postComment(repo, pr.number, `${MARKER}\n${output}`);
    log(`posted review for ${repo}#${pr.number}`);
    return 'posted';
  } catch (e) {
    log(`FAILED ${repo}#${pr.number}: ${(e as Error).message}`);
    return 'failed';
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
