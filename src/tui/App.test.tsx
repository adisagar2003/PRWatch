import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config.js';

let tmp: string;

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const plain = (s: string | undefined): string => (s ?? '').replace(ANSI, '');
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('App dashboard', () => {
  it('draws every panel title inside its top border with a hotkey digit', async () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />);
    await settle();
    const frame = plain(lastFrame());
    expect(frame).toMatch(/╭─┤1 daemon├─+╮/);
    expect(frame).toContain('2 agent');
    expect(frame).toContain('3 repos');
    expect(frame).toContain('4 activity');
  });

  it('shows live daemon and repo data on the dashboard without any navigation', async () => {
    await fs.writeFile(
      path.join(tmp, 'state.json'),
      JSON.stringify({
        lastTickAt: new Date().toISOString(),
        repos: {
          'a/b': {
            watchStartedAt: '2020-01-01T00:00:00.000Z',
            reviewed: [1, 2, 3],
            failed: [],
            retries: { '5': 1 },
          },
        },
      }),
    );
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />);
    await settle();
    const frame = plain(lastFrame());
    expect(frame).toContain('running');
    expect(frame).toContain('a/b');
    expect(frame).toMatch(/3/);
  });

  it('graphs posted reviews from the daemon log', async () => {
    await fs.mkdir(path.join(tmp, 'logs'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'logs', 'daemon.log'),
      '[' + new Date().toISOString() + '] posted review for a/b#1\n',
    );
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />);
    await settle();
    const frame = plain(lastFrame());
    expect(frame).toContain('reviews');
    expect(frame).toMatch(/[▁▂▃▄▅▆▇█]/);
  });

  it('opens the repos screen on 3 and returns to the dashboard on esc', async () => {
    const { stdin, lastFrame } = render(
      <App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />,
    );
    await settle();
    stdin.write('3');
    await settle();
    expect(plain(lastFrame())).toContain('add a repo');
    stdin.write(ESC);
    await settle();
    expect(plain(lastFrame())).toContain('4 activity');
  });

  it('keeps a one-line header instead of the full banner once repos are watched', async () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />);
    await settle();
    const frame = plain(lastFrame());
    expect(frame).toContain('prwatch');
    expect(frame).not.toContain('⣿'); // no braille art competing with the panels
  });

  it('shows the full banner as the empty state when nothing is watched yet', async () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    await settle();
    expect(plain(lastFrame())).toContain('⣿');
  });

  it('surfaces a corrupt state file on the dashboard instead of crashing', async () => {
    await fs.writeFile(path.join(tmp, 'state.json'), '{invalid json}');
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b'] }} />);
    await settle();
    expect(plain(lastFrame())).toMatch(/invalid state/);
  });
});
