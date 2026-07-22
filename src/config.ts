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

function validateConfig(c: unknown): Config {
  if (typeof c !== 'object' || c === null) {
    throw new Error('config must be an object');
  }

  const obj = c as Record<string, unknown>;
  const merged = { ...DEFAULT_CONFIG, ...obj };

  // Validate agent
  if (!['claude', 'codex', 'opencode'].includes(merged.agent)) {
    throw new Error(`invalid agent: must be one of 'claude', 'codex', 'opencode'`);
  }

  // Validate repos
  if (!Array.isArray(merged.repos)) {
    throw new Error('repos must be an array');
  }
  if (!merged.repos.every((r) => typeof r === 'string')) {
    throw new Error('repos must be an array of strings');
  }

  // Validate pollIntervalMinutes
  if (typeof merged.pollIntervalMinutes !== 'number' || !Number.isFinite(merged.pollIntervalMinutes) || merged.pollIntervalMinutes <= 0) {
    throw new Error('pollIntervalMinutes must be a finite number > 0');
  }

  // Validate agentTimeoutMinutes
  if (typeof merged.agentTimeoutMinutes !== 'number' || !Number.isFinite(merged.agentTimeoutMinutes) || merged.agentTimeoutMinutes <= 0) {
    throw new Error('agentTimeoutMinutes must be a finite number > 0');
  }

  return merged;
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    return validateConfig(raw);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid config at ${configPath()}: ${message}`);
  }
}

export async function saveConfig(c: Config): Promise<void> {
  await fs.mkdir(prwatchHome(), { recursive: true });
  const target = configPath();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(c, null, 2) + '\n');
  await fs.rename(tmp, target);
}
