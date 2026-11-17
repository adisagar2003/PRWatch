import { ensureDirs, cacheDir } from '../paths.js';
import { loadConfig, type Config } from '../config.js';
import {
  loadState, saveState as persistState, ensureRepoState,
  recordReviewed, recordFailure, recordConflictFailure, pruneConflictAttempts,
  backfillReviewedHeads, markOwnPush, recordHistory, type State,
} from '../state.js';
import { ensureHomeRubric } from '../rubric.js';
import { GitHubForge, checkGhAuth } from '../forge/github.js';
import { getAgent, type AgentAdapter } from '../agents/index.js';
import type { ForgeAdapter, PR } from '../forge/types.js';
import { prsNeedingReview, prsNeedingConflictCheck } from './filter.js';
import { runReviewJob } from './job.js';
import { runConflictJob } from './conflict.js';
import { selectChatRequests, runChatJob } from './chat.js';
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
  // Taken before any review runs: chat baselines here, so mentions made mid-review still count.
  const tickStart = now();

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
      const rereview = sinceSha !== undefined;
      const started = await startJob(deps, repo, pr, 'review', rereview);
      const result = await runReviewJob(
        { forge, agent, cacheRoot, timeoutMs, log, onReviewedHead, profile: config.profile,
          lineComments: config.lineComments }, repo, pr, sinceSha,
      );
      finishJob(deps, repo, pr, 'review', rereview, started, result === 'skipped-existing' || result === 'skipped-closed' ? 'skipped' : result);
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

    if (config.chat) await answerMentions(deps, repo, prs, timeoutMs, tickStart);

    if (!config.autoResolveConflicts) continue;
    pruneConflictAttempts(rs, prs);
    for (const pr of prsNeedingConflictCheck(prs, rs)) {
      const onPushed = (before: string, after: string) => markOwnPush(rs, pr.number, before, after);
      const started = await startJob(deps, repo, pr, 'conflict', false);
      const result = await runConflictJob(
        { forge, agent, cacheRoot, timeoutMs, log, onPushed }, repo, pr,
      );
      // A clean PR is checked every tick: only log jobs that did something.
      if (result === 'skipped') deps.state.active = null;
      else finishJob(deps, repo, pr, 'conflict', false, started, result);
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

/** Mark a job live for the TUI. Returns its start time. */
async function startJob(deps: TickDeps, repo: string, pr: PR, kind: 'review' | 'conflict', rereview: boolean): Promise<Date> {
  const started = deps.now();
  deps.state.active = { repo, pr: pr.number, title: pr.title, kind, startedAt: started.toISOString(), rereview };
  await deps.saveState(deps.state);
  return started;
}

function finishJob(
  deps: TickDeps, repo: string, pr: PR, kind: 'review' | 'conflict', rereview: boolean,
  started: Date, outcome: 'posted' | 'failed' | 'skipped' | 'resolved',
): void {
  const at = deps.now();
  deps.state.active = null;
  recordHistory(deps.state, {
    repo, pr: pr.number, title: pr.title, author: pr.author, fromFork: pr.fromFork, kind,
    at: at.toISOString(), durationMs: at.getTime() - started.getTime(), outcome, rereview,
  });
}

const CHAT_OVERLAP_MS = 60_000;

async function answerMentions(
  deps: TickDeps, repo: string, prs: PR[], timeoutMs: number, tickStart: Date,
) {
  const { forge, agent, state, saveState, cacheRoot, log } = deps;
  const rs = state.repos[repo];
  if (rs.chatSince === undefined) {
    // No backlog: only mentions after chat was switched on get answers.
    rs.chatSince = tickStart.toISOString();
    await saveState(state);
    return;
  }
  let comments;
  try {
    const since = new Date(Date.parse(rs.chatSince) - CHAT_OVERLAP_MS).toISOString();
    comments = await forge.listCommentsSince(repo, since);
  } catch (e) {
    log(`could not list comments for ${repo}: ${(e as Error).message}`);
    return;
  }
  const cursor = rs.chatCursor ?? 0;
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  for (const c of selectChatRequests(comments, prs, cursor)) {
    // Failures aren't retried: the asker can tag again.
    await runChatJob({ forge, agent, cacheRoot, timeoutMs, log }, repo, byNumber.get(c.pr)!, c);
    rs.chatCursor = c.id;
    await saveState(state);
  }
  rs.chatCursor = Math.max(cursor, rs.chatCursor ?? 0, ...comments.map((c) => c.id));
  rs.chatSince = tickStart.toISOString();
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
