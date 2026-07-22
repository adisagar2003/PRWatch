# prwatch — Local BYO-Agent PR Reviewer (v1 Design)

**Date:** 2026-07-21
**Status:** Approved for planning
**Repo:** New standalone open-source repo (spec lives here temporarily; the tool is NOT part of groundwork)

## Problem

Running AI code review in GitHub Actions costs money per run. Developers already
have local AI coding agents (Claude Code, Codex, OpenCode) with flat-rate
subscriptions. prwatch is a local tool: the user authenticates with GitHub,
picks repos to watch, and a local daemon automatically reviews every newly
opened PR with the agent of their choice and posts the review as a PR comment.
Zero CI cost.

## V1 Scope

- **Forge:** GitHub only (via the user's existing `gh` CLI auth). GitLab is v2,
  behind a `ForgeAdapter` interface designed in from the start.
- **Agents:** claude, codex, opencode — all three from day one ("BYO agent" is
  the differentiator).
- **Trigger:** polling. Only PRs opened *after* a repo starts being watched are
  reviewed — no backlog spam.
- **Output:** one structured summary comment per PR (no inline diff comments in
  v1). Findings carry `file:line` references so inline comments can be added in
  v2 without rework.
- **Stack:** TypeScript + Ink (React for terminal UIs), published on npm.

## Architecture

One npm package, two entry points:

| Command | Role |
|---|---|
| `prw` | Ink TUI: auth check, add/remove watched repos, pick agent, poll interval, edit rubric, daemon status, recent-review log |
| `prw daemon` | Long-running foreground process: poll → detect → review → comment → cleanup |

The daemon is a plain foreground process (run it in tmux, or anywhere). The TUI
offers an optional "install as service" action that writes a launchd plist
(macOS) or systemd user unit (Linux) so the daemon survives reboots. No hidden
child processes, no IPC (inter-process communication) — the TUI reads daemon
status from state/log files on disk.

### State directory: `~/.prwatch/`

| File | Contents |
|---|---|
| `config.json` | watched repos, chosen agent, poll interval, timeout |
| `state.json` | per-repo watch-start timestamp (cursor) + reviewed-PR ledger + per-PR retry counts |
| `rubric.md` | default review rubric (shipped with the tool, user-editable). A watched repo can override it by committing `.prwatch/rubric.md` at its root |
| `logs/daemon.log` | append-only daemon log |
| `cache/` | temp clones; always empty between reviews |

### Auth

No OAuth app of our own in v1. All GitHub calls shell out to `gh` (`gh api`,
`gh pr checkout`, `gh pr comment`), reusing the user's existing login. The TUI
runs `gh auth status` on startup and instructs the user to run `gh auth login`
if it fails. `gh` (and `git`) are hard prerequisites, checked at startup.

## Review cycle (data flow)

1. Every N minutes (default 3), for each watched repo:
   `gh api repos/{owner}/{repo}/pulls?state=open&sort=created&direction=desc`.
2. Filter to PRs where `created_at` > the repo's watch-start timestamp AND the
   PR number is not in the reviewed ledger AND retry count < 3.
3. Enqueue matching PRs. **One review runs at a time** (agents are heavy;
   serial queue in v1).
4. Per job:
   a. Shallow clone (`git clone --depth 50`) into `~/.prwatch/cache/<owner>-<repo>-<pr>/`.
   b. `gh pr checkout <n>` inside the clone.
   c. Spawn the chosen agent headless in that directory (full-repo context, not
      diff-only). Prompt = rubric + PR title/body + diff summary + output-format
      instruction (verdict, scored rubric table, findings list with `file:line`).
   d. Post the agent's stdout as a single PR comment via `gh pr comment`,
      prefixed with a hidden marker `<!-- prwatch -->`.
   e. `finally`: **delete the temp clone unconditionally** (success or failure),
      record the PR in the ledger, log the outcome.

### Idempotency

Two layers: the reviewed-PR ledger in `state.json`, plus the `<!-- prwatch -->`
marker — before commenting, the daemon lists existing PR comments and skips if
a marked comment already exists. This survives a deleted/corrupted `state.json`.

### Error handling

- Agent crash / non-zero exit / timeout (default 10 min): log, increment the
  PR's retry count (max 2 retries → then marked `failed`), clean the clone.
- `gh` rate limit or network failure: log and wait for the next tick — no tight
  retry loops.
- Empty/garbage agent output (< 50 chars): treat as failure, do not post.
- The daemon never crashes on a single bad job; every job is wrapped.

## Agent adapter layer

```ts
interface AgentAdapter {
  name: 'claude' | 'codex' | 'opencode';
  isInstalled(): Promise<boolean>;          // e.g. `which claude`
  review(opts: { cwd: string; prompt: string; timeoutMs: number }): Promise<string>;
}
```

Headless invocations:

| Agent | Command |
|---|---|
| claude | `claude -p "<prompt>"` |
| codex | `codex exec "<prompt>"` |
| opencode | `opencode run "<prompt>"` |

Each adapter is a thin `child_process.spawn` wrapper with timeout and stdout
capture (~40 lines). The TUI only offers agents whose `isInstalled()` passes.

## Forge adapter (v2 seam)

```ts
interface ForgeAdapter {
  name: 'github';                            // 'gitlab' in v2
  listOpenPRs(repo: string): Promise<PR[]>;
  checkout(repo: string, pr: number, dir: string): Promise<void>;
  hasMarkerComment(repo: string, pr: number): Promise<boolean>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
}
```

Only the GitHub implementation ships in v1, but all daemon code calls through
this interface.

## Rubric

The shipped default `rubric.md` is a scored checklist (1–5 per category:
correctness, security, tests, readability, scope) plus severity-tagged
findings. Resolution order: repo's `.prwatch/rubric.md` if present, else
`~/.prwatch/rubric.md`.

## Testing

- **Unit (vitest):** PR filtering/cursor logic, ledger idempotency, retry
  counting, prompt assembly, cleanup-on-failure (assert cache dir empty after a
  thrown job).
- **Adapter tests:** a fake agent binary (shell script echoing canned output)
  so CI needs no API keys; also a hanging script to test timeout kill.
- **Manual E2E:** script that opens a PR on a scratch GitHub repo and asserts a
  marked comment appears.

## Non-goals (v1)

- GitLab, Bitbucket
- Inline diff comments
- Webhooks / real-time triggers
- Our own GitHub OAuth app
- Parallel reviews
- Windows support (macOS/Linux only)
