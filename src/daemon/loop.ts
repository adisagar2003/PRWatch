import { ensureDirs, cacheDir } from '../paths.js';
import { loadConfig, type Config } from '../config.js';
import {
  loadState, saveState as persistState, ensureRepoState,
  recordReviewed, recordFailure, recordConflictFailure, pruneConflictAttempts,
  backfillReviewedHeads, markOwnPush, type State,
} from '../state.js';
import { ensureHomeRubric } from '../rubric.js';
import { GitHubForge, checkGhAuth } from '../forge/github.js';
import { getAgent, type AgentAdapter } from '../agents/index.js';
import type { ForgeAdapter } from '../forge/types.js';
import { prsNeedingReview, prsNeedingConflictCheck } from './filter.js';
import { runReviewJob } from './job.js';
import { runConflictJob } from './conflict.js';
import { createLogger } from './log.js';
import { killActiveProcessGroups } from '../run-command.js';
import { notify } from '../notify.js';

export interface TickDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  config: Config;
  state: State;
  saveState: (s: State) => Promise<void>;
  cacheRoot: string;
  log: (msg: string) => void;
  now: () => Date;
  notify: (title: string, message: string) => void;
}

export async function tick(deps: TickDeps): Promise<void> {
  const { forge, agent, config, state, saveState, cacheRoot, log, now, notify: send } = deps;
  const announce = (msg: string) => { if (config.notifications) send('PRWatch', msg); };
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
    backfillReviewedHeads(rs, prs);
    for (const pr of prsNeedingReview(prs, rs, config.reReviewOnPush)) {
      const sinceSha = rs.reviewed.includes(pr.number)
        ? rs.reviewedHeads?.[String(pr.number)]
        : undefined;
      // ponytail: a re-review failing MAX_ATTEMPTS times marks the PR failed for good, same
      // as a first review. Per-head failure counters (like conflictAttempts) if that bites.
      let reviewedHead = pr.headSha;
      const onReviewedHead = (sha: string) => { reviewedHead = sha; };
      const result = await runReviewJob(
        { forge, agent, cacheRoot, timeoutMs, log, onReviewedHead, profile: config.profile,
          lineComments: config.lineComments }, repo, pr, sinceSha,
      );
      if (result === 'failed') {
        recordFailure(rs, pr.number);
        // Only once we've given up — retries would otherwise notify MAX_ATTEMPTS times.
        if (rs.failed.includes(pr.number)) {
          announce(`review failed for ${repo}#${pr.number} · ${pr.title}`);
        }
      } else {
        recordReviewed(rs, pr.number, reviewedHead);
        if (result === 'posted') announce(`posted review for ${repo}#${pr.number} · ${pr.title}`);
      }
      await saveState(state);
    }

    if (!config.autoResolveConflicts) continue;
    pruneConflictAttempts(rs, prs);
    for (const pr of prsNeedingConflictCheck(prs, rs)) {
      const onPushed = (before: string, after: string) => markOwnPush(rs, pr.number, before, after);
      const result = await runConflictJob(
        { forge, agent, cacheRoot, timeoutMs, log, onPushed }, repo, pr,
      );
      if (result === 'failed') {
        recordConflictFailure(rs, pr.number, pr.headSha);
        announce(`could not resolve conflicts in ${repo}#${pr.number} · ${pr.title}`);
      } else if (result === 'resolved') {
        announce(`resolved conflicts in ${repo}#${pr.number} · ${pr.title}`);
      }
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
      notify,
    });
    await sleep(config.pollIntervalMinutes * 60_000);
  }
}
