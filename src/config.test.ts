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

  it('rejects corrupt JSON', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), '{invalid json}');
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*config\.json/);
  });

  it('rejects invalid agent value', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ agent: 'gpt' }));
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*agent/);
  });

  it('rejects repos when not an array', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ repos: 'a/b' }));
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*repos/);
  });

  it('rejects invalid repos array (non-string elements)', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ repos: [123] }));
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*repos/);
  });

  it('rejects non-positive pollIntervalMinutes', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ pollIntervalMinutes: 0 }));
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*pollIntervalMinutes/);
  });

  it('rejects non-positive agentTimeoutMinutes', async () => {
    await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify({ agentTimeoutMinutes: -1 }));
    await expect(loadConfig()).rejects.toThrow(/invalid config at.*agentTimeoutMinutes/);
  });
});
