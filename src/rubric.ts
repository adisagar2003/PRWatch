import fs from 'node:fs/promises';
import path from 'node:path';
import { rubricPath, prwatchHome } from './paths.js';

export const DEFAULT_RUBRIC = `# Code Review (Radical Candor)

Review as a full-stack architect: **care personally + challenge directly**. Catch
real issues, and pair every one with a concrete fix. Focus on substance over
preference — skip pure style nits. Use a **constructive** tone (honest about
problems, but explain why they matter). Ground claims in specific files and lines.

## Project standards

If the repo has a \`Technical.md\` (root or \`.candid/Technical.md\`), read it and flag
violations as **📜 Standards**, citing the specific rule. If it has none, review
without project-specific standards.

## Categorize every issue by severity

| Icon | Category | What it covers |
|---|---|---|
| 🔥 | Critical | Production killers: crashes, security holes (injection, auth bypass, secrets), data loss, race conditions |
| ⚠️ | Major | Serious problems: missing error handling on I/O, no input validation at boundaries, N+1 queries, blocking calls |
| 📜 | Standards | Violations of a rule in the repo's Technical.md (only if present) |
| 📋 | Code Smell | Maintainability: over-long/duplicated code, deep nesting, magic numbers, unclear names |
| 🤔 | Edge Case | Unhandled scenarios: null/empty, concurrency, timeouts, network failure, timezones, large inputs |
| 💭 | Architectural | Design concerns: coupling, single-responsibility violations, not following existing patterns |

## Per-issue format

Write each issue as a level-3 heading followed by these labelled lines:

- \`### [icon] [short title]\`
- \`**File:** path/to/file.ts:42-45\`
- \`**Confidence:** Safe ✓ | Verify ⚡ | Careful ⚠️\`
- \`**Problem:** what is wrong\`
- \`**Impact:** why it matters (production / security / performance / maintenance)\`
- \`**Fix:**\` followed by a fenced code block containing the concrete fix

Confidence = risk of the fix: **Safe ✓** mechanical / no behavior change · **Verify ⚡**
logic change, test it · **Careful ⚠️** architectural, may have side effects.

## Output structure (follow exactly, omit empty sections)

1. **Summary** — one short paragraph: what the PR does and your overall assessment.
2. **🔥 Critical Issues**
3. **⚠️ Major Concerns**
4. **📜 Standards Violations**
5. **📋 Code Smells**
6. **🤔 Missing Edge Cases**
7. **💭 Architectural Concerns**
8. **✅ What's Good** — brief, acknowledge what's done well.

If you find no issues in a category, omit its heading. If the PR is clean, say so
in the Summary and keep only **✅ What's Good**.
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
