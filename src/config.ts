import fs from 'node:fs/promises';
import { configPath, prwatchHome } from './paths.js';

export type AgentName = 'claude' | 'codex' | 'opencode';

export interface Config {
  repos: string[];
  agent: AgentName;
  pollIntervalMinutes: number;
  agentTimeoutMinutes: number;
}

export const DEFAULT_CONFIG: Config = {
  repos: [],
  agent: 'claude',
  pollIntervalMinutes: 3,
  agentTimeoutMinutes: 10,
};

export async function loadConfig(): Promise<Config> {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(c: Config): Promise<void> {
  await fs.mkdir(prwatchHome(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(c, null, 2) + '\n');
}
