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

const C_ESCAPES: Record<string, string> = { a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r' };

/** The new-side path from a `+++ ` header; undefined for /dev/null. Undoes git's C-style quoting. */
function newPath(header: string): string | undefined {
  // Git appends a tab to names containing spaces, and quotes names with special or non-ASCII bytes.
  let p = header.slice(4).replace(/\t$/, '');
  if (p.startsWith('"') && p.endsWith('"')) {
    const bytes = p.slice(1, -1).split(/(\\[0-7]{3}|\\.)/).map((part) =>
      /^\\[0-7]{3}$/.test(part) ? Buffer.from([parseInt(part.slice(1), 8)])
        : Buffer.from(part.startsWith('\\') ? C_ESCAPES[part[1]] ?? part[1] : part));
    p = Buffer.concat(bytes).toString('utf8');
  }
  return p.startsWith('b/') ? p.slice(2) : undefined;
}

/** For each file in a unified diff: new-side line numbers GitHub accepts comments on. */
export function commentableLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let next = 0;
  let prev = '';
  // File headers only come before a file's first hunk; inside one, "--- x" / "+++ y" are content.
  let inHeader = false;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      lines = undefined;
      inHeader = true;
    } else if (inHeader && raw.startsWith('+++ ') && prev.startsWith('--- ')) {
      // Deleted files have no new side to comment on.
      const target = newPath(raw);
      lines = undefined;
      if (target !== undefined) files.set(target, (lines = new Set()));
    } else if (raw.startsWith('@@')) {
      inHeader = false;
      if (lines) next = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
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
  if (c.suggestion === undefined) return c.body;
  // A fence must be longer than any backtick run inside it, or replacement code like ``` closes it early.
  const longest = Math.max(0, ...(c.suggestion.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${c.body}\n\n${fence}suggestion\n${c.suggestion}\n${fence}`;
}
