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
  it('shows a status box and a reviews box', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    const f = plain(lastFrame());
    expect(f).toMatch(/╭─ status ─+/);
    expect(f).toMatch(/╭─ reviews ─+/);
  });

  it('never draws past the terminal width', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    for (const line of plain(lastFrame()).split('\n')) expect([...line].length).toBeLessThanOrEqual(100);
  });

  it('lists jobs newest first with what happened', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain('REVIEW');
    expect(f).toContain('FIXED');
    expect(f.indexOf('a/b#2')).toBeLessThan(f.indexOf('a/b#1'));
  });

  it('summarises the last 24 hours', async () => {
    await seed();
    const { lastFrame } = app();
    await settle();
    expect(plain(lastFrame())).toContain('1 reviews · 0 re-reviews · 1 conflicts fixed');
  });

  it('shows the review running right now', async () => {
    await seed({ active: { repo: 'a/b', pr: 3, title: 'Refund endpoint', kind: 'conflict', startedAt: iso(1), rereview: false } });
    const { lastFrame } = app();
    await settle();
    expect(plain(lastFrame())).toMatch(/resolving conflicts in a\/b#3 · Refund endpoint/);
  });

  it('reports health and whether conflict auto-fix is on', async () => {
    await seed();
    const { lastFrame } = app({ agent: 'codex', autoResolveConflicts: false });
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain('● daemon up');
    expect(f).toContain('● gh');
    expect(f).toContain('● codex');
    expect(f).toContain('conflict auto-fix off');
  });

  it('toggles conflict auto-fix with c and saves it', async () => {
    await seed();
    const { stdin, lastFrame } = app({ autoResolveConflicts: false });
    await settle();
    stdin.write('c');
    await settle(80);
    expect(plain(lastFrame())).toContain('conflict auto-fix on');
    const saved = JSON.parse(await fs.readFile(path.join(tmp, 'config.json'), 'utf8'));
    expect(saved.autoResolveConflicts).toBe(true);
  });

  it('says how to fix a logged-out agent', async () => {
    auth = 'not-authed';
    await seed();
    const { lastFrame } = app({ agent: 'codex' });
    await settle();
    expect(plain(lastFrame())).toContain('codex is not logged in → codex login');
  });

  it('moves the cursor and opens the selected PR on enter', async () => {
    await seed();
    const { stdin, open } = app();
    await settle();
    stdin.write(`${ESC}[B`);
    await settle(50);
    stdin.write('\r');
    await settle(50);
    expect(open).toHaveBeenCalledWith('https://github.com/a/b/pull/1');
  });

  it('swaps the reviews for the log on l', async () => {
    await seed();
    await fs.mkdir(path.join(tmp, 'logs'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'logs', 'daemon.log'), `[${iso(1)}] posted review for a/b#2\n`);
    const { stdin, lastFrame } = app();
    await settle();
    stdin.write('l');
    await settle(50);
    const f = plain(lastFrame());
    expect(f).toMatch(/╭─ log ─/);
    expect(f).toContain('posted review for a/b#2');
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
    expect(plain(lastFrame())).toContain('─ reviews ─');
  });

  it('shows the splash when nothing is watched yet', async () => {
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
