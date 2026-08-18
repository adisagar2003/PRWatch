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

export interface LogEntry {
  at: Date;
  text: string;
}

const STAMPED = /^\[([^\]]+)\] (.*)$/;

/** Log lines that wrapped (agent/gh output) carry no timestamp — drop them. */
export function parseLog(lines: string[]): LogEntry[] {
  return lines.flatMap((line) => {
    const m = STAMPED.exec(line);
    const at = m ? new Date(m[1]) : null;
    return at && !Number.isNaN(at.getTime()) ? [{ at, text: m![2] }] : [];
  });
}

/** Posted reviews per time bucket, oldest bucket first — the activity graph. */
export function reviewHistogram(
  entries: LogEntry[],
  now: Date,
  bucketMs: number,
  buckets: number,
): number[] {
  const counts = new Array<number>(buckets).fill(0);
  const start = now.getTime() - buckets * bucketMs;
  for (const e of entries) {
    if (!e.text.startsWith('posted review')) continue;
    const i = Math.floor((e.at.getTime() - start) / bucketMs);
    if (i >= 0 && i < buckets) counts[i] += 1;
  }
  return counts;
}

export async function tailLog(n = 10): Promise<string[]> {
  try {
    const lines = (await fs.readFile(logFile(), 'utf8')).trimEnd().split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}
