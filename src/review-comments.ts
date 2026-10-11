// Line comments: turns the agent's review output into comments pinned to
// specific lines of the PR diff, with GitHub "suggestion" blocks for fixes.
// runReviewJob calls it when `lineComments` is on: splitReview separates the
// markdown summary from the agent's ```prwatch-comments JSON block, and
// keepInDiff drops comments GitHub would reject (one bad line fails the whole
// batch). The agent's JSON is untrusted output, so everything is validated here.
import type { LineComment } from './forge/types.js';

export interface AgentLineComment extends LineComment {
  /** Replacement text for lines startLine..line, posted as a one-click suggestion. */
  suggestion?: string;
}

export const MAX_LINE_COMMENTS = 20;

const BLOCK = /\n*```prwatch-comments[^\n]*\n([\s\S]*?)(?:\n```[^\n]*|$)/g;

function isComment(v: unknown): v is AgentLineComment {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  const lineOk = (n: unknown) => Number.isInteger(n) && (n as number) >= 1;
  return (
    typeof c.path === 'string' && c.path !== '' &&
    lineOk(c.line) &&
    typeof c.body === 'string' && c.body.trim() !== '' &&
    (c.startLine === undefined || (lineOk(c.startLine) && (c.startLine as number) <= (c.line as number))) &&
    (c.suggestion === undefined || typeof c.suggestion === 'string')
  );
}

/** The markdown review without any prwatch-comments block, plus the valid comments from it. */
export function splitReview(output: string): {
  summary: string; comments: AgentLineComment[]; error: string | undefined;
} {
  const blocks = [...output.matchAll(BLOCK)];
  const summary = output.replace(BLOCK, '').trim();
  if (blocks.length === 0) return { summary, comments: [], error: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(blocks[blocks.length - 1][1]);
  } catch (e) {
    return { summary, comments: [], error: `line comments are not valid JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { summary, comments: [], error: 'line comments JSON is not an array' };
  return { summary, comments: parsed.filter(isComment).slice(0, MAX_LINE_COMMENTS), error: undefined };
}

/** For each file in a unified diff: new-side line numbers GitHub accepts comments on. */
export function commentableLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let next = 0;
  let prev = '';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      lines = undefined;
    } else if (raw.startsWith('+++ ') && prev.startsWith('--- ')) {
      const target = raw.slice(4);
      // Deleted files have no new side to comment on.
      lines = target.startsWith('b/') ? new Set() : undefined;
      if (lines) files.set(target.slice(2), lines);
    } else if (lines && raw.startsWith('@@')) {
      next = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (lines && next > 0 && (raw.startsWith(' ') || raw.startsWith('+'))) {
      lines.add(next++);
    }
    prev = raw;
  }
  return files;
}

/** Keep comments whose every line is in the diff; ranges may not span a gap between hunks. */
export function keepInDiff<T extends LineComment>(
  comments: T[], diff: Map<string, Set<number>>,
): { kept: T[]; dropped: number } {
  const kept = comments.filter((c) => {
    const lines = diff.get(c.path);
    if (!lines) return false;
    for (let l = c.startLine ?? c.line; l <= c.line; l++) if (!lines.has(l)) return false;
    return true;
  });
  return { kept, dropped: comments.length - kept.length };
}

export function formatCommentBody(c: AgentLineComment): string {
  return c.suggestion === undefined ? c.body : `${c.body}\n\n\`\`\`suggestion\n${c.suggestion}\n\`\`\``;
}
