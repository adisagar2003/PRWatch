import { runCommand } from '../run-command.js';
import type { AgentName } from '../config.js';

/** 'unknown' = the CLI is there but offers no way to ask whether it's logged in. */
export type AgentAuth = 'missing' | 'ok' | 'not-authed' | 'unknown';

/** How to ask a CLI whether it is logged in. `ok` inspects stdout when exit 0 isn't proof. */
export interface AuthCheck {
  args: string[];
  ok?: (stdout: string) => boolean;
  login?: string;
}

export interface AgentAdapter {
  name: AgentName;
  hasAuthCheck: boolean;
  /** The command that fixes a logged-out agent, shown in the TUI. */
  loginHint?: string;
  isInstalled(): Promise<boolean>;
  checkAuth(): Promise<AgentAuth>;
  review(opts: { cwd: string; prompt: string; timeoutMs: number }): Promise<string>;
}

const AUTH_TIMEOUT_MS = 10_000;

export function makeAgent(
  name: AgentName,
  bin: string,
  buildArgs: (prompt: string) => string[],
  auth?: AuthCheck,
): AgentAdapter {
  return {
    name,
    hasAuthCheck: auth !== undefined,
    loginHint: auth?.login,
    async isInstalled() {
      try {
        await runCommand('/usr/bin/which', [bin], { timeoutMs: 5_000 });
        return true;
      } catch {
        return false;
      }
    },
    async checkAuth() {
      if (!(await this.isInstalled())) return 'missing';
      if (auth === undefined) return 'unknown';
      try {
        const out = await runCommand(bin, auth.args, { timeoutMs: AUTH_TIMEOUT_MS });
        return auth.ok === undefined || auth.ok(out) ? 'ok' : 'not-authed';
      } catch {
        return 'not-authed';
      }
    },
    review({ cwd, prompt, timeoutMs }) {
      return runCommand(bin, buildArgs(prompt), { cwd, timeoutMs });
    },
  };
}

export const agents: AgentAdapter[] = [
  // claude has no auth-status subcommand — installed is all we can honestly report.
  makeAgent('claude', 'claude', (p) => ['-p', p]),
  makeAgent('codex', 'codex', (p) => ['exec', p], {
    args: ['login', 'status'],
    login: 'codex login',
  }),
  makeAgent('opencode', 'opencode', (p) => ['run', p], {
    args: ['auth', 'list'],
    // `auth list` exits 0 even with nothing stored; the count is the real answer.
    ok: (out) => /[1-9]\d* credential/.test(out),
    login: 'opencode auth login',
  }),
];

export function getAgent(name: AgentName): AgentAdapter {
  const found = agents.find((a) => a.name === name);
  if (!found) throw new Error(`unknown agent: ${name}`);
  return found;
}

export async function detectInstalledAgents(): Promise<AgentAdapter[]> {
  const flags = await Promise.all(agents.map((a) => a.isInstalled()));
  return agents.filter((_, i) => flags[i]);
}
