<!--
Shared context for building prwatch's next review features (the CodeRabbit-parity
set). Read it before starting any of them: it fixes the shared vocabulary, the
rules today's code depends on, and which files each feature touches. Specs in
docs/superpowers/specs/ go deeper on one feature each; this file is the map
that connects them.
-->

# prwatch — Context

## What prwatch is

A local daemon (a background process that keeps running) that watches GitHub
repos. When a new PR opens, it clones the PR, runs the user's own AI agent CLI
(`claude`, `codex`, or `opencode`) against a review rubric, and posts **one**
review comment. It never uses CI, so CI cost is $0.

## Glossary

| Term | Meaning |
|---|---|
| **Tick** | One pass of the daemon loop: list open PRs for every repo, then review / resolve conflicts. Runs every `pollIntervalMinutes`. (`src/daemon/loop.ts`) |
| **Job** | One unit of work on one PR inside a tick: a review job (`job.ts`) or a conflict job (`conflict.ts`). |
| **Forge** | The Git host. `ForgeAdapter` (`src/forge/types.ts`) is the interface; `GitHubForge` is the only implementation and calls the `gh` CLI. |
| **Agent** | The user's AI CLI. `AgentAdapter.review()` (`src/agents/index.ts`) takes a prompt and returns the agent's stdout as a string. |
| **Rubric** | Markdown telling the agent what to check and how to format the review. Resolution order: repo `.prwatch/rubric.md` → `~/.prwatch/rubric.md` → `DEFAULT_RUBRIC`. (`src/rubric.ts`) |
| **Marker** | `<!-- prwatch -->`, an invisible HTML comment at the top of every review. Its presence on a PR means "already reviewed". |
| **Head SHA** | ID of the PR's latest commit. Changes on every push. |
| **State** | `~/.prwatch/state.json`: per-repo `reviewed`, `failed`, `retries`, `conflictAttempts`. (`src/state.ts`) |
| **Fix confidence** | Existing per-issue field: Safe ✓ / Verify ⚡ / Careful ⚠️ = how risky the *suggested fix* is. |
| **Merge confidence** | New, PR-wide rating: High 🟢 / Medium 🟡 / Low 🔴. Never call it just "confidence". |

## How a review flows today

```
tick → listOpenPRs → prsNeedingReview (filter.ts)
     → runReviewJob: isOpen? → hasMarkerComment? → clone → resolveRubric
       → buildPrompt → agent.review → isOpen again? → postComment(MARKER + output)
     → recordReviewed / recordFailure → saveState
```

## Rules the code relies on (break one = a bug)

1. **Review once per PR.** Enforced twice: `state.reviewed` holds PR *numbers*
   (not SHAs), and `hasMarkerComment` skips if any marker exists.
2. **Only PRs created after watching started** (`watchStartedAt`), so no backlog spam.
3. **Clones are always deleted** (`finally` in every job).
4. **PR text is untrusted.** Title/body are fenced in `<untrusted-pr-content>`.
   Files in the checkout can also carry prompt injection (text written to
   hijack the agent's instructions).
5. **Agents are read-only for reviews** (`write: false`). Exception: `opencode run`
   has no read-only mode.
6. **Agent output is free-form markdown.** Nothing parses it; the only check is
   length ≥ 50 chars.
7. **Every agent must work.** No feature may depend on one agent's special abilities
   (e.g. Claude Code skills).
8. **`state.json` is hand-validated.** New fields must be optional
   (`field?:`) so old state files still load.

## The features

| # | Feature | Touches | Main gotcha |
|---|---|---|---|
| 1 | **Review profiles** (Quiet / Chill / Assertive) | `config.ts` (new `profile` key), `rubric.ts` | Decided: a tone line appended after the rubric in `prompt.ts`, so it applies to repo/home overrides too. `chill` adds nothing (current behavior). |
| 2 | **Review order diagram + merge confidence** | `rubric.ts` only | Spec: `docs/superpowers/specs/2026-10-11-review-order-and-merge-confidence.md`. Partly covers Codegraph / semantic diffs. |
| 3 | **Re-review on push** | `state.ts`, `filter.ts`, `job.ts` | Breaks Rule 1 on purpose: `reviewed` must become SHA-aware and the marker check must compare SHAs. **prwatch's own conflict-merge commits change the head SHA, so they must not trigger a re-review.** Review only the diff since the last reviewed SHA. Old state must migrate. |
| 4 | **Learnings** | new `~/.prwatch/learnings.md` (+ repo `.prwatch/learnings.md`), `prompt.ts` | Who adds entries (TUI? a `@prwatch learn …` comment, which needs #5?). Cap the size so the prompt doesn't grow forever. |
| 5 | **Chat: reply when tagged `@prwatch`** | `ForgeAdapter` (list comments since X), `state.ts` (last handled comment id per PR), new chat job | **Security:** on a public repo anyone can tag the bot and run *your* agent on *your* subscription with their text. Default to replying only to repo collaborators. Never let the question run with `write: true`. |
| 6 | **Line comments with suggested fixes** | `ForgeAdapter` (new `postReview` via `gh api …/pulls/N/reviews`), `job.ts`, rubric | Breaks Rule 6: the agent must return structured output (JSON: file, line, body, suggestion) that we parse and validate. GitHub rejects the **whole** review if one comment's line isn't in the diff, so validate lines against the diff first and fall back to the summary comment. |

Codegraph / blast radius and semantic diffs are not separate features: #2's
diagram covers the useful part. Revisit after #2 ships.

## Build order

1 → 2 → 3 → 4 → 5 → 6. Cheapest and most isolated first. #3 changes state, so it
lands before the features that add more state (#5). #6 changes the output
contract, so it goes last; #2's diagram then moves into the summary part of
the review.

One feature per branch and PR, each built test-first (failing test → code →
refactor). They share the same choke points (`job.ts`, `state.ts`, the rubric,
`ForgeAdapter`), so building them in parallel would mean constant merge conflicts.
