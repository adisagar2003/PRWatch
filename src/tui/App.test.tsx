import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config.js';
import type { AgentAuth } from '../agents/index.js';

let tmp: string;
let auth: AgentAuth = 'ok';

vi.mock('../forge/github.js', () => ({ checkGhAuth: async () => true, listUserRepos: async () => [] }));
vi.mock('../agents/index.js', () => ({
  getAgent: (name: string) => ({ name, loginHint: `${name} login`, checkAuth: async () => auth }),
  detectInstalledAgents: async () => [],
}));

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const plain = (s: string | undefined): string => (s ?? '').replace(ANSI, '');
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
  auth = 'ok';
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

async function seed(extra: Record<string, unknown> = {}) {
  await fs.writeFile(
    path.join(tmp, 'state.json'),
    JSON.stringify({
      lastTickAt: iso(0),
      repos: { 'a/b': { watchStartedAt: iso(9999), reviewed: [1, 2], failed: [], retries: {} } },
      history: [
        { repo: 'a/b', pr: 1, title: 'Add download route', author: 'mallory', kind: 'review', at: iso(30),
          durationMs: 90_000, outcome: 'posted', rereview: false },
        { repo: 'a/b', pr: 2, title: 'Bump lodash', author: 'bot', kind: 'conflict', at: iso(10),
          durationMs: 40_000, outcome: 'resolved', rereview: false },
      ],
      ...extra,
    }),
  );
}

const app = (over = {}, open = vi.fn()) => ({
  open,
  ...render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'], ...over }} open={open} />),
});

describe('App dashboard', () => {
  it('draws btop boxes with superscript hotkeys in the top border', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    const f = plain(lastFrame());
    expect(f).toMatch(/╭─¹activity─+/);
    expect(f).toContain('²system');
    expect(f).toContain('³repos');
    expect(f).toContain('⁴reviews');
    expect(f).toContain('⁵log');
  });

  it('never draws past the terminal width', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    for (const line of plain(lastFrame()).split('\n')) expect([...line].length).toBeLessThanOrEqual(100);
  });

  it('lists jobs newest first with result badges', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain('REVIEW');
    expect(f).toContain('FIXED');
    expect(f.indexOf('a/b#2')).toBeLessThan(f.indexOf('a/b#1'));
  });

  it('shows the review running right now', async () => {
    await seed({ active: { repo: 'a/b', pr: 3, title: 'Refund endpoint', kind: 'conflict', startedAt: iso(1), rereview: false } });
    const { lastFrame } = app();
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain('a/b#3');
    expect(f).toContain('MERGING');
  });

  it('reports system health: daemon, gh, agent and feature flags', async () => {
    await seed();
    const { lastFrame } = app({ agent: 'codex', autoResolveConflicts: true, chat: false });
    await settle();
    const f = plain(lastFrame());
    expect(f).toMatch(/daemon\s+up/);
    expect(f).toMatch(/gh\s+logged in/);
    expect(f).toMatch(/codex\s+auth OK/);
    expect(f).toContain('◆ auto-fix');
    expect(f).toContain('◇ chat');
  });

  it('toggles conflict auto-fix with c', async () => {
    await seed();
    const { stdin, lastFrame } = app({ autoResolveConflicts: false });
    await settle();
    stdin.write('c');
    await settle(80);
    const f = plain(lastFrame());
    expect(f).toContain('auto-fix conflicts on');
    expect(f).toContain('◆ auto-fix');
    const saved = JSON.parse(await fs.readFile(path.join(tmp, 'config.json'), 'utf8'));
    expect(saved.autoResolveConflicts).toBe(true);
  });

  it('names the login command when the agent is logged out', async () => {
    auth = 'not-authed';
    await seed();
    const { lastFrame } = app({ agent: 'codex' });
    await settle();
    expect(plain(lastFrame())).toContain('codex login');
  });

  it('moves the cursor and opens the selected PR on enter', async () => {
    await seed();
    const { stdin, open } = app();
    await settle();
    stdin.write(`${ESC}[B`); // down
    await settle(50);
    stdin.write('\r');
    await settle(50);
    expect(open).toHaveBeenCalledWith('https://github.com/a/b/pull/1');
  });

  it('filters reviews as you type', async () => {
    await seed();
    const { stdin, lastFrame } = app();
    await settle();
    stdin.write('f');
    await settle(30);
    for (const ch of 'lodash') {
      stdin.write(ch);
      await settle(20);
    }
    await settle(50);
    const f = plain(lastFrame());
    expect(f).toContain('filter lodash');
    expect(f).toContain('a/b#2');
    expect(f).not.toContain('a/b#1 ');
  });

  it('hides a box with its number key', async () => {
    await seed();
    const { stdin, lastFrame } = app();
    await settle();
    stdin.write('1');
    await settle(50);
    expect(plain(lastFrame())).not.toContain('activity');
  });

  it('opens the repos screen on r and returns on esc', async () => {
    await seed();
    const { stdin, lastFrame } = app();
    await settle();
    stdin.write('r');
    await settle(50);
    expect(plain(lastFrame())).toContain('add a repo');
    stdin.write(ESC);
    await settle(50);
    expect(plain(lastFrame())).toContain('⁴reviews');
  });

  it('shows the eye splash when nothing is watched yet', async () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} open={vi.fn()} />);
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain('welcome');
    expect(f).toContain('⣿');
  });

  it('surfaces a corrupt state file instead of crashing', async () => {
    await fs.writeFile(path.join(tmp, 'state.json'), '{invalid json}');
    const { lastFrame } = app();
    await settle();
    expect(plain(lastFrame())).toMatch(/invalid state/);
  });
});
