<div align="center">

<img src="https://raw.githubusercontent.com/adisagar2003/PRWatch/main/assets/banner.svg" alt="PRWatch" width="100%" />

<br />

**[Website &amp; docs → prwatch-one.vercel.app](https://prwatch-one.vercel.app)**

<br />

[![npm](https://img.shields.io/npm/v/prwatch?style=flat-square&color=2ea8ff&labelColor=04070c&logo=npm)](https://www.npmjs.com/package/prwatch)
[![license](https://img.shields.io/badge/license-MIT-ff3b30?style=flat-square&labelColor=04070c)](#license)
[![node](https://img.shields.io/badge/node-%E2%89%A520-2ea8ff?style=flat-square&labelColor=04070c&logo=node.js&logoColor=79e6ff)](https://nodejs.org)
[![agents](https://img.shields.io/badge/agents-claude%20%7C%20codex%20%7C%20opencode-79e6ff?style=flat-square&labelColor=04070c)](#prerequisites)
[![CI cost](https://img.shields.io/badge/CI%20cost-%240.00-ff3b30?style=flat-square&labelColor=04070c)](#why)

</div>

---

Review your own pull requests with the AI agent you **already pay for** — locally, with zero CI cost.

prwatch is a small daemon + TUI (terminal user interface — a keyboard-driven app that runs in your terminal). You pick GitHub repos to watch; whenever a **new** PR is opened, prwatch shallow-clones it, runs your local agent (Claude Code, Codex, or OpenCode) against a review rubric, and posts one structured review comment on the PR. Temp clones are always deleted afterward.

<img src="https://raw.githubusercontent.com/adisagar2003/PRWatch/main/assets/flow.svg" alt="new PR → shallow clone → your agent runs the rubric → one review comment → clone deleted" width="100%" />

## Why

|  | |
|---|---|
| 💸 **Zero CI cost** | Nothing runs in GitHub Actions. The review happens on your machine with the agent subscription you already have. |
| 🤖 **Your agent, your rules** | `claude`, `codex`, or `opencode`, auto-detected from your `PATH`. The rubric is a markdown file you own. |
| 🧹 **No backlog, no spam** | Only PRs opened after you start watching. Each PR reviewed exactly once. Temp clones always deleted. |

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
prw                   # TUI: add repos, pick your agent, check status
prw daemon            # start the watcher in the foreground (tmux-friendly)
prw service install   # optional: run at login via launchd/systemd
```

<img width="1502" alt="prwatch TUI" src="https://github.com/user-attachments/assets/4c1b8abc-f259-4fc9-955a-3e49e5c229df" />

Only PRs opened **after** you start watching a repo are reviewed — no backlog spam. Each PR gets reviewed once (the marker comment `<!-- prwatch -->` guarantees idempotency — running twice can't produce a second review).

## Configuration

`~/.prwatch/config.json`. The TUI writes it; editing by hand is fine.

```json
{
  "repos": ["adisagar2003/PRWatch"],
  "agent": "claude",
  "pollIntervalMinutes": 3,
  "agentTimeoutMinutes": 10
}
```

| Key | Default | Notes |
|---|---|---|
| `repos` | `[]` | Array of `owner/name` strings. |
| `agent` | `"claude"` | One of `claude`, `codex`, `opencode`. |
| `pollIntervalMinutes` | `3` | How often open PRs are listed. |
| `agentTimeoutMinutes` | `10` | Hard timeout per review; the agent process is killed past it. |

## Rubric

The default rubric lives at `~/.prwatch/rubric.md` — edit it freely.
A repo can override it by committing `.prwatch/rubric.md` at its root.

## Security

Watching a public repo means running your agent against untrusted input: the PR title/body, and the PR's own files (which can include agent-instruction files like `CLAUDE.md` that an attacker committed to influence your agent). Recommendations:

- Only watch repos you trust, or ones where you review PRs from trusted contributors only.
- Run the agent with restrictive permission settings (e.g. no auto-approve of shell/network tools) when watching third-party repos.

prwatch fences the PR title/description inside `<untrusted-pr-content>` tags in the prompt sent to your agent, but this cannot prevent an agent from reading attacker-added files in the checkout itself — that mitigation must come from your agent's own permission model.

## State

Everything lives in `~/.prwatch/`:

| Path | Contents |
|---|---|
| `config.json` | Watched repos, agent, intervals. |
| `state.json` | Watch start times and the reviewed-PR ledger. |
| `rubric.md` | Your default review rubric. |
| `logs/daemon.log` | Poll, review, and post activity — first place to look. |
| `cache/` | Temp shallow clones. Empty between reviews. |

## Finding repos to watch

If you installed prwatch, the TUI has this built in: **Repos → add a repo** fuzzy-searches your GitHub repos live (type to filter, enter to add) — no extra tools needed.

### `repo-find.sh` (source checkout only)

There's also a standalone shell helper for use outside the TUI. It is **not bundled in the npm package** — it only ships in a source checkout of this repo (`git clone`). Requires `gh` (logged in) and `fzf`.

```sh
./repo-find.sh          # pick a repo, print its URL
./repo-find.sh open     # pick a repo, open it in the browser
./repo-find.sh clone    # pick a repo, clone it into the current folder
./repo-find.sh view     # pick a repo, show its details in the terminal
```

A live preview pane shows `gh repo view` details for whatever you're hovering. The repo list is cached for 10 minutes under `${XDG_CACHE_HOME:-~/.cache}/prwatch/` so repeat runs are fast. Fetches up to 300 repos by default — raise it with `REPO_LIMIT=500 ./repo-find.sh`.

## Development

```sh
npm install
npm run dev         # run the TUI from source
npm run typecheck
npm test
```

Manual end-to-end walkthrough: [`docs/e2e.md`](./docs/e2e.md). The website lives in [`web/`](./web) and deploys to Vercel as a static page.

## License

MIT

<div align="center">
<sub><a href="https://prwatch-one.vercel.app">prwatch-one.vercel.app</a> · <a href="https://www.npmjs.com/package/prwatch">npm</a> · <a href="https://github.com/adisagar2003/PRWatch/issues">issues</a></sub>
</div>
