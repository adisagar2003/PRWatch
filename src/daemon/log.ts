import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logsDir } from '../paths.js';

const logFile = (): string => path.join(logsDir(), 'daemon.log');

export function createLogger(): (msg: string) => void {
  return (msg) => {
    fsSync.mkdirSync(logsDir(), { recursive: true });
    fsSync.appendFileSync(logFile(), `[${new Date().toISOString()}] ${msg}\n`);
  };
}

export async function tailLog(n = 10): Promise<string[]> {
  try {
    const lines = (await fs.readFile(logFile(), 'utf8')).trimEnd().split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}
