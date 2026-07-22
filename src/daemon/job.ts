import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import { resolveRubric } from '../rubric.js';
import { buildPrompt } from '../prompt.js';
import { MARKER } from '../forge/github.js';

export type JobResult = 'posted' | 'skipped-existing' | 'skipped-closed' | 'failed';

export interface JobDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  cacheRoot: string;
  timeoutMs: number;
  log: (msg: string) => void;
}

const MIN_OUTPUT_CHARS = 50;

const PRWATCH_URL = 'https://github.com/adisagar2003/PRWatch';

function attribution(agentName: string): string {
  return `\n\n---\n👁️🌀 *By [PRWatch](${PRWATCH_URL}) · reviewed with \`${agentName}\`*`;
}

export async function runReviewJob(deps: JobDeps, repo: string, pr: PR): Promise<JobResult> {
  const { forge, agent, cacheRoot, timeoutMs, log } = deps;

  const dir = path.join(cacheRoot, `${repo.replace('/', '-')}-${pr.number}`);

  try {
    if (!(await forge.isOpen(repo, pr.number))) {
      log(`skip ${repo}#${pr.number}: no longer open`);
      return 'skipped-closed';
    }

    if (await forge.hasMarkerComment(repo, pr.number)) {
      log(`skip ${repo}#${pr.number}: prwatch comment already exists`);
      return 'skipped-existing';
    }

    await fs.mkdir(cacheRoot, { recursive: true });

    log(`reviewing ${repo}#${pr.number} "${pr.title}" with ${agent.name}`);
    await forge.clone(repo, pr.number, dir);
    const rubric = await resolveRubric(dir);
    const prompt = buildPrompt(rubric, repo, pr);
    const output = (await agent.review({ cwd: dir, prompt, timeoutMs })).trim();
    if (output.length < MIN_OUTPUT_CHARS) {
      throw new Error(`agent output too short (${output.length} chars)`);
    }
    if (!(await forge.isOpen(repo, pr.number))) {
      log(`skip ${repo}#${pr.number}: closed or merged while the review ran`);
      return 'skipped-closed';
    }
    await forge.postComment(repo, pr.number, `${MARKER}\n${output}${attribution(agent.name)}`);
    log(`posted review for ${repo}#${pr.number}`);
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
