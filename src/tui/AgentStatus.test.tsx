import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { Dashboard } from './Dashboard.js';
import { DEFAULT_CONFIG } from '../config.js';
import type { AgentAuth } from '../agents/index.js';

let tmp: string;
let auth: AgentAuth = 'ok';
let loginHint: string | undefined = 'codex login';

vi.mock('../forge/github.js', () => ({ checkGhAuth: async () => true }));
vi.mock('../agents/index.js', () => ({
  getAgent: (name: string) => ({
    name,
    loginHint,
    checkAuth: async () => auth,
  }),
}));

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const plain = (s: string | undefined): string => (s ?? '').replace(ANSI, '');
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

const config = { ...DEFAULT_CONFIG, agent: 'codex' as const, repos: ['a/b'] };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
  auth = 'ok';
  loginHint = 'codex login';
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function frame() {
  const { lastFrame } = render(<Dashboard config={config} width={100} logHeight={2} />);
  await settle();
  return plain(lastFrame());
}

describe('agent panel auth', () => {
  it('reports the agent as authed alongside gh', async () => {
    expect(await frame()).toContain('codex auth OK');
  });

  it('names the login command when the agent is logged out', async () => {
    auth = 'not-authed';
    const f = await frame();
    expect(f).toContain('codex NOT LOGGED IN');
    expect(f).toContain('codex login');
  });

  it('reports a missing agent binary as not installed', async () => {
    auth = 'missing';
    expect(await frame()).toContain('codex NOT FOUND');
  });

  it('says installed, not OK, when the CLI offers no way to check auth', async () => {
    auth = 'unknown';
    loginHint = undefined;
    const f = await frame();
    expect(f).toContain('codex installed');
    expect(f).not.toContain('codex auth OK');
  });
});
