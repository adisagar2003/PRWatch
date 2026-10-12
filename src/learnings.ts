// Team "learnings": short notes like "we allow default exports here" that every
// review should respect, so prwatch stops re-flagging things the team already
// decided. runReviewJob calls resolveLearnings and appends the result to the
// agent prompt. Sources are .prwatch/learnings.md on the repo's default branch
// (never the PR's copy, so a PR can't relax its own review) and the user's
// ~/.prwatch/learnings.md; both are hand-edited markdown.
import fs from 'node:fs/promises';
import path from 'node:path';
import { learningsPath } from './paths.js';
import { defaultBranchFile } from './daemon/git.js';

/** Per file. Keeps a runaway learnings file from crowding the diff out of the prompt. */
export const MAX_LEARNINGS_CHARS = 4000;

const cap = (text: string) =>
  text.length > MAX_LEARNINGS_CHARS ? `${text.slice(0, MAX_LEARNINGS_CHARS)}\n(truncated)` : text;

async function readCapped(file: string): Promise<string> {
  let text: string;
  try {
    // Read at most the cap's worth of bytes (UTF-8 is <= 4 bytes/char) so a huge
    // file in a PR can't exhaust memory.
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(MAX_LEARNINGS_CHARS * 4);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      text = buf.toString('utf8', 0, bytesRead).trim();
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error(`cannot read learnings at ${file}: ${(err as Error).message}`);
  }
  return cap(text);
}

async function repoLearnings(cloneDir: string): Promise<string> {
  try {
    return cap(((await defaultBranchFile(cloneDir, '.prwatch/learnings.md')) ?? '').trim());
  } catch (err) {
    throw new Error(`cannot read learnings at .prwatch/learnings.md: ${(err as Error).message}`);
  }
}

/** The prompt block to append, or '' when there are no learnings. Repo learnings come first. */
export async function resolveLearnings(cloneDir: string): Promise<string> {
  const parts = [
    await repoLearnings(cloneDir),
    await readCapped(learningsPath()),
  ].filter((p) => p !== '');
  if (parts.length === 0) return '';
  return `

Team learnings — conventions this team has already decided. Do not report anything they allow, and follow them when suggesting fixes:
${parts.join('\n\n')}`;
}
