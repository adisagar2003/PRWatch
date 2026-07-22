import { ensureDirs, cacheDir } from '../paths.js';
import { loadConfig, type Config } from '../config.js';
import {
  loadState, saveState as persistState, ensureRepoState,
  recordReviewed, recordFailure, type State,
} from '../state.js';
import { ensureHomeRubric } from '../rubric.js';
import { GitHubForge, checkGhAuth } from '../forge/github.js';
import { getAgent, type AgentAdapter } from '../agents/index.js';
import type { ForgeAdapter } from '../forge/types.js';
import { prsNeedingReview } from './filter.js';
import { runReviewJob } from './job.js';
import { createLogger } from './log.js';
import { killActiveProcessGroups } from '../run-command.js';

export interface TickDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  config: Config;
  state: State;
  saveState: (s: State) => Promise<void>;
  cacheRoot: string;
  log: (msg: string) => void;
  now: () => Date;
}

export async function tick(deps: TickDeps): Promise<void> {
  const { forge, agent, config, state, saveState, cacheRoot, log, now } = deps;
  const timeoutMs = config.agentTimeoutMinutes * 60_000;

  for (const repo of config.repos) {
    const rs = ensureRepoState(state, repo, now());
    let prs;
    try {
      prs = await forge.listOpenPRs(repo);
    } catch (e) {
      log(`could not list PRs for ${repo}: ${(e as Error).message}`);
      continue;
    }
    for (const pr of prsNeedingReview(prs, rs)) {
      state.currentJob = { repo, pr: pr.number, agent: agent.name, startedAt: now().toISOString() };
      await saveState(state);
      const result = await runReviewJob({ forge, agent, cacheRoot, timeoutMs, log }, repo, pr);
      state.currentJob = null;
      if (result === 'failed') recordFailure(rs, pr.number);
      else recordReviewed(rs, pr.number);
      await saveState(state);
    }
  }

  state.lastTickAt = now().toISOString();
  await saveState(state);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startDaemon(): Promise<never> {
  await ensureDirs();
  await ensureHomeRubric();
  const log = createLogger();

  if (!(await checkGhAuth())) {
    log('gh is not authenticated — run `gh auth login`');
    console.error('prwatch: gh is not authenticated. Run `gh auth login` first.');
    process.exit(1);
  }

  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    log(`daemon stopping (${signal})`);
    killActiveProcessGroups();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log('daemon started');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const config = await loadConfig();
    const state = await loadState();
    await tick({
      forge: new GitHubForge(),
      agent: getAgent(config.agent),
      config,
      state,
      saveState: persistState,
      cacheRoot: cacheDir(),
      log,
      now: () => new Date(),
    });
    await sleep(config.pollIntervalMinutes * 60_000);
  }
}
