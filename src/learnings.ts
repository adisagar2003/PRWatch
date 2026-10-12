// Team "learnings": short notes like "we allow default exports here" that every
// review should respect, so prwatch stops re-flagging things the team already
// decided. runReviewJob calls resolveLearnings and appends the result to the
// agent prompt. Sources are the repo's committed .prwatch/learnings.md and the
// user's ~/.prwatch/learnings.md; both are hand-edited markdown.
import fs from 'node:fs/promises';
import path from 'node:path';
import { learningsPath } from './paths.js';

/** Per file. Keeps a runaway learnings file from crowding the diff out of the prompt. */
export const MAX_LEARNINGS_CHARS = 4000;

/** `root`, when given, is a directory the file must really live in (after following symlinks). */
async function readCapped(file: string, root?: string): Promise<string> {
  let text: string;
  try {
    // A PR can commit learnings.md as a symlink to e.g. ~/.ssh/id_rsa; reading it
    // would paste that secret into the prompt and possibly the public review.
    if (root && !(await fs.realpath(file)).startsWith((await fs.realpath(root)) + path.sep)) {
      throw new Error('it resolves outside the checkout');
    }
    text = (await fs.readFile(file, 'utf8')).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error(`cannot read learnings at ${file}: ${(err as Error).message}`);
  }
  return text.length > MAX_LEARNINGS_CHARS ? `${text.slice(0, MAX_LEARNINGS_CHARS)}\n(truncated)` : text;
}

/** The prompt block to append, or '' when there are no learnings. Repo learnings come first. */
export async function resolveLearnings(cloneDir: string): Promise<string> {
  const parts = [
    await readCapped(path.join(cloneDir, '.prwatch', 'learnings.md'), cloneDir),
    await readCapped(learningsPath()),
  ].filter((p) => p !== '');
  if (parts.length === 0) return '';
  return `

Team learnings — conventions this team has already decided. Do not report anything they allow, and follow them when suggesting fixes:
${parts.join('\n\n')}`;
}
