import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('config', () => {
  it('returns defaults when no file exists', async () => {
    expect(await loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips save and load', async () => {
    const c = { ...DEFAULT_CONFIG, repos: ['adisagar2003/groundwork'], agent: 'codex' as const };
    await saveConfig(c);
    expect(await loadConfig()).toEqual(c);
  });

  it('fills missing keys with defaults (forward compat)', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ repos: ['a/b'] }));
    const c = await loadConfig();
    expect(c.repos).toEqual(['a/b']);
    expect(c.agent).toBe('claude');
    expect(c.pollIntervalMinutes).toBe(3);
  });
});
