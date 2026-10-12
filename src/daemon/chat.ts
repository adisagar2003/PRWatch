// Chat: lets a repo collaborator ask prwatch a question by writing "@prwatch …"
// in a PR comment. Each tick, loop.ts lists the repo's new comments once
// (forge.listCommentsSince), picks the ones to answer with selectChatRequests,
// and runs runChatJob for each: clone the PR, ask the user's agent read-only,
// post the reply. Off unless `chat: true`, because it lets other people spend
// your agent subscription.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeAdapter, PR, PRComment } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';
import { MARKER } from '../forge/github.js';
import { buildChatPrompt } from '../prompt.js';
import { PRWATCH_URL } from './job.js';

/** Marks chat replies. Deliberately not MARKER, so a reply never counts as "already reviewed". */
export const CHAT_MARKER = '<!-- prwatch-chat -->';

/**
 * GitHub author_association values we answer. Not the same as write access: MEMBER is any
 * member of the owning org, COLLABORATOR any invited collaborator (even read-only).
 */
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const MENTION = /(^|[^\w@.])@prwatch(?![\w-])/i;

/** Drops "> …" lines, so quoting an earlier question doesn't ask it again. */
const unquoted = (body: string) => body.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');

export type ChatResult = 'replied' | 'failed';

export interface ChatDeps {
  forge: ForgeAdapter;
  agent: AgentAdapter;
  cacheRoot: string;
  timeoutMs: number;
  log: (msg: string) => void;
}

/** Comments past the cursor that a trusted person wrote to @prwatch on an open PR. */
export function selectChatRequests(comments: PRComment[], open: PR[], cursor: number): PRComment[] {
  const openPrs = new Set(open.map((p) => p.number));
  return comments.filter(
    (c) =>
      c.id > cursor &&
      openPrs.has(c.pr) &&
      TRUSTED.has(c.association) &&
      MENTION.test(unquoted(c.body)) &&
      // prwatch posts as your gh account, so its own comments look like yours.
      !c.body.includes(MARKER) &&
      !c.body.includes(CHAT_MARKER),
  );
}

function quote(question: string): string {
  const firstLine = question.trim().split('\n')[0].slice(0, 200);
  return `> ${firstLine}`;
}

export async function runChatJob(
  deps: ChatDeps, repo: string, pr: PR, comment: PRComment,
): Promise<ChatResult> {
  const { forge, agent, cacheRoot, timeoutMs, log } = deps;
  const dir = path.join(cacheRoot, `${repo.replace('/', '-')}-${pr.number}-chat-${comment.id}`);
  try {
    log(`answering @${comment.author} on ${repo}#${pr.number} with ${agent.name}`);
    await fs.mkdir(cacheRoot, { recursive: true });
    await forge.clone(repo, pr.number, dir);
    const answer = (await agent.review({
      cwd: dir, prompt: buildChatPrompt(repo, pr, comment.body), timeoutMs,
    })).trim();
    if (answer === '') throw new Error('agent gave an empty answer');
    const footer = `\n\n---\n👁️🌀 *By [PRWatch](${PRWATCH_URL}) · answered with \`${agent.name}\`*`;
    // A reply holding MARKER would make hasMarkerComment treat the PR as already reviewed.
    const reply = `${quote(comment.body)}\n\n${answer}`.replaceAll(MARKER, '&lt;!-- prwatch --&gt;');
    await forge.postComment(repo, pr.number, `${CHAT_MARKER}\n${reply}${footer}`);
    log(`posted chat reply on ${repo}#${pr.number}`);
    return 'replied';
  } catch (e) {
    log(`CHAT FAILED ${repo}#${pr.number}: ${(e as Error).message}`);
    return 'failed';
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
