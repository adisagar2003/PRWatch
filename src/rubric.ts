import fs from 'node:fs/promises';
import path from 'node:path';
import { rubricPath, prwatchHome } from './paths.js';
import { defaultBranchFile } from './daemon/git.js';

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

## Merge confidence

Rate the whole PR, set by these rules so it always matches the issues you list:

- **Low 🔴** any 🔥 Critical issue, or source code behavior changed with no tests
  (docs/config-only PRs never need tests)
- **Medium 🟡** any ⚠️ Major issue, and Low doesn't apply
- **High 🟢** neither of the above

Always follow the rating with a one-line reason. This is separate from the
per-issue **Confidence** field, which rates the risk of a fix.

## Review order diagram

Suggest the order a human should read the changed files in: where the change
starts (types, schema, core logic), then its callers, then tests, then
docs/config. If the PR changes only 1-2 files, skip the diagram and write one
line ("Read X, then Y").

Otherwise draw a Mermaid flowchart:

- One node per file, numbered in reading order. Group lockfiles, generated
  files and snapshots into one node, or leave them out.
- At most 12 nodes. Past that, group by folder: \`"5. src/tui/ (4 files)"\`.
- Put every label in double quotes so paths render.
- Wrap nodes in one \`subgraph\` per layer (Types, Logic, UI, Tests,
  Docs/Config), skipping empty layers. Subgraph ids must differ from node ids.
- Nodes with a 🔥 Critical or ⚠️ Major issue get class \`risk\`; all others get
  \`clean\`. Copy the two \`classDef\` lines exactly as below.

\`\`\`mermaid
flowchart TD
  subgraph types["Types"]
    A["1. src/types.ts"]
  end
  subgraph logic["Logic"]
    B["2. src/core.ts"]
  end
  subgraph tests["Tests"]
    C["3. src/core.test.ts"]
  end
  A --> B --> C
  classDef risk fill:#ffebe9,stroke:#d1242f,color:#1f2328
  classDef clean fill:#dafbe1,stroke:#1a7f37,color:#1f2328
  class B risk
  class A,C clean
\`\`\`

Below the diagram, add one numbered line per node saying why to read it at that
point.

## Output structure (follow exactly, omit empty issue categories)

1. **Summary** — one short paragraph: what the PR does and your overall assessment.
2. **🎯 Merge Confidence:** High 🟢 | Medium 🟡 | Low 🔴 — one line on why.
3. **🧭 Review Order** — the Mermaid diagram and per-node lines (or the one-line
   order for 1-2 files).
4. **🔥 Critical Issues**
5. **⚠️ Major Concerns**
6. **📜 Standards Violations**
7. **📋 Code Smells**
8. **🤔 Missing Edge Cases**
9. **💭 Architectural Concerns**
10. **✅ What's Good** — brief, acknowledge what's done well.

If you find no issues in a category, omit its heading. If the PR is clean, say so
in the Summary and still include **🎯 Merge Confidence**, **🧭 Review Order** and
**✅ What's Good**; omit only the empty issue categories.
`;

export async function resolveRubric(cloneDir: string): Promise<string> {
  // From the default branch, not the PR checkout: a PR must not grade itself.
  try {
    const repoRubric = await defaultBranchFile(cloneDir, '.prwatch/rubric.md');
    if (repoRubric !== null) return repoRubric;
  } catch (err) {
    throw new Error(`cannot read rubric at .prwatch/rubric.md: ${(err as Error).message}`);
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

// The candid-review default shipped before merge confidence and the review
// order diagram were added. Kept only so ensureHomeRubric can migrate an
// un-customised install. Do not edit — it must match the old bytes exactly.
export const CANDID_V1_RUBRIC = `# Code Review (Radical Candor)

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

// The score-table default shipped before the candid-review rewrite. Kept only
// so ensureHomeRubric can recognise an un-customised legacy install and migrate
// it. Do not edit — it must match the old bytes exactly.
export const LEGACY_DEFAULT_RUBRIC = `# Review Rubric

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

export async function ensureHomeRubric(): Promise<void> {
  await fs.mkdir(prwatchHome(), { recursive: true });
  try {
    const current = await fs.readFile(rubricPath(), 'utf8');
    // Upgrade un-customised legacy installs to the new default; a rubric the
    // user has edited (anything else) is left untouched.
    if (current === LEGACY_DEFAULT_RUBRIC || current === CANDID_V1_RUBRIC) {
      await fs.writeFile(rubricPath(), DEFAULT_RUBRIC);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await fs.writeFile(rubricPath(), DEFAULT_RUBRIC);
  }
}
