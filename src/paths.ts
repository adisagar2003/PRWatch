import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export function prwatchHome(): string {
  return process.env.PRWATCH_HOME ?? path.join(os.homedir(), '.prwatch');
}

export const configPath = (): string => path.join(prwatchHome(), 'config.json');
export const statePath = (): string => path.join(prwatchHome(), 'state.json');
export const rubricPath = (): string => path.join(prwatchHome(), 'rubric.md');
export const cacheDir = (): string => path.join(prwatchHome(), 'cache');
export const logsDir = (): string => path.join(prwatchHome(), 'logs');

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.mkdir(logsDir(), { recursive: true });
}
