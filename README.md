# PRWATCH
<img width="1502" height="726" alt="image" src="https://github.com/user-attachments/assets/4c1b8abc-f259-4fc9-955a-3e49e5c229df" />

Review your own pull requests with the AI agent you already pay for — locally, with zero CI cost.

prwatch is a small daemon + TUI. You pick GitHub repos to watch; whenever a **new** PR is opened, prwatch shallow-clones it, runs your local agent (Claude Code, Codex, or OpenCode) against a review rubric, and posts one structured review comment on the PR. Temp clones are always deleted afterward.

## Prerequisites

- Node.js ≥ 20
- `gh` (GitHub CLI), logged in: `gh auth login`
- At least one agent CLI: `claude`, `codex`, or `opencode`

## Install

```sh
npm install -g prwatch
```

## Use

```sh
prw            # TUI: add repos, pick your agent, check status
prw daemon     # start the watcher in the foreground (tmux-friendly)
prw service install   # optional: run at login via launchd/systemd
```

Only PRs opened **after** you start watching a repo are reviewed — no backlog spam. Each PR gets reviewed once (marker comment `<!-- prwatch -->` guarantees idempotency).

## Rubric

The default rubric lives at `~/.prwatch/rubric.md` — edit it freely.
A repo can override it by committing `.prwatch/rubric.md` at its root.

## Security

Watching a public repo means running your agent against untrusted input: the PR title/body, and the PR's own files (which can include agent-instruction files like `CLAUDE.md` that an attacker committed to influence your agent). Recommendations:

- Only watch repos you trust, or ones where you review PRs from trusted contributors only.
- Run the agent with restrictive permission settings (e.g. no auto-approve of shell/network tools) when watching third-party repos.

prwatch fences the PR title/description inside `<untrusted-pr-content>` tags in the prompt sent to your agent, but this cannot prevent an agent from reading attacker-added files in the checkout itself — that mitigation must come from your agent's own permission model.

## State

Everything lives in `~/.prwatch/`: `config.json`, `state.json`, `rubric.md`, `logs/`, `cache/` (empty between reviews).

## Helper: fuzzy-find your repos

`repo-find.sh` lists your GitHub repos and lets you fuzzy-search them (handy for picking which repos to watch). Requires `gh` (logged in) and `fzf`.

```sh
./repo-find.sh          # pick a repo, print its URL
./repo-find.sh open     # pick a repo, open it in the browser
./repo-find.sh clone    # pick a repo, clone it into the current folder
./repo-find.sh view     # pick a repo, show its details in the terminal
```

A live preview pane shows `gh repo view` details for whatever you're hovering. The repo list is cached for 10 minutes (in your temp dir) so repeat runs are fast. Fetches up to 300 repos by default — raise it with `REPO_LIMIT=500 ./repo-find.sh`.

## License

MIT
