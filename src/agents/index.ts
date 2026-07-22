import { runCommand } from '../run-command.js';
import type { AgentName } from '../config.js';

export interface AgentAdapter {
  name: AgentName;
  isInstalled(): Promise<boolean>;
  review(opts: { cwd: string; prompt: string; timeoutMs: number }): Promise<string>;
}

export function makeAgent(
  name: AgentName,
  bin: string,
  buildArgs: (prompt: string) => string[],
): AgentAdapter {
  return {
    name,
    async isInstalled() {
      try {
        await runCommand('/usr/bin/which', [bin], { timeoutMs: 5_000 });
        return true;
      } catch {
        return false;
      }
    },
    review({ cwd, prompt, timeoutMs }) {
      return runCommand(bin, buildArgs(prompt), { cwd, timeoutMs });
    },
  };
}

export const agents: AgentAdapter[] = [
  makeAgent('claude', 'claude', (p) => ['-p', p]),
  makeAgent('codex', 'codex', (p) => ['exec', p]),
  makeAgent('opencode', 'opencode', (p) => ['run', p]),
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
