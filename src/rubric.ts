import fs from 'node:fs/promises';
import path from 'node:path';
import { rubricPath, prwatchHome } from './paths.js';

export const DEFAULT_RUBRIC = `# Review Rubric

Score each category 1-5 (1 = severe problems, 5 = excellent):

| Category | What to check |
|---|---|
| Correctness | Logic errors, edge cases, race conditions, broken behavior |
| Security | Injection, auth gaps, secrets in code, unsafe input handling |
| Tests | New/changed behavior covered? Tests meaningful, not tautological? |
| Readability | Naming, structure, dead code, needless complexity |
| Scope | Does the PR do one thing? Unrelated changes mixed in? |

## Output format (follow exactly)

1. **Verdict:** APPROVE or REQUEST CHANGES (one line).
2. **Scores:** the table above with a 1-5 score and one-line justification per category.
3. **Findings:** bullet list, each as \`[blocker|major|minor|nit] path/to/file.ts:123 — explanation\`. If none, write "No findings."
4. Keep the whole review under 500 words.
`;

export async function resolveRubric(cloneDir: string): Promise<string> {
  const repoOverride = path.join(cloneDir, '.prwatch', 'rubric.md');
  try {
    return await fs.readFile(repoOverride, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`cannot read rubric at ${repoOverride}: ${(err as Error).message}`);
    }
  }

  const homeRubric = rubricPath();
  try {
    return await fs.readFile(homeRubric, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`cannot read rubric at ${homeRubric}: ${(err as Error).message}`);
    }
  }

  return DEFAULT_RUBRIC;
}

export async function ensureHomeRubric(): Promise<void> {
  await fs.mkdir(prwatchHome(), { recursive: true });
  try {
    await fs.access(rubricPath());
  } catch {
    await fs.writeFile(rubricPath(), DEFAULT_RUBRIC);
  }
}
