import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prwatchHome, configPath, statePath, rubricPath, cacheDir, logsDir, ensureDirs } from './paths.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('paths', () => {
  it('honors PRWATCH_HOME', () => {
    expect(prwatchHome()).toBe(tmp);
  });

  it('defaults to ~/.prwatch when env is unset', () => {
    delete process.env.PRWATCH_HOME;
    expect(prwatchHome()).toBe(path.join(os.homedir(), '.prwatch'));
  });

  it('derives all paths from home', () => {
    expect(configPath()).toBe(path.join(tmp, 'config.json'));
    expect(statePath()).toBe(path.join(tmp, 'state.json'));
    expect(rubricPath()).toBe(path.join(tmp, 'rubric.md'));
    expect(cacheDir()).toBe(path.join(tmp, 'cache'));
    expect(logsDir()).toBe(path.join(tmp, 'logs'));
  });

  it('ensureDirs creates cache and logs dirs', async () => {
    await ensureDirs();
    await expect(fs.stat(cacheDir())).resolves.toBeTruthy();
    await expect(fs.stat(logsDir())).resolves.toBeTruthy();
  });
});
