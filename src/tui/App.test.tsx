import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('App', () => {
  it('renders the main menu', () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('prwatch');
    expect(frame).toContain('Status');
    expect(frame).toContain('Repos');
    expect(frame).toContain('Agent');
    expect(frame).toContain('Install service');
    expect(frame).toContain('Quit');
  });

  it('renders the banner art above the menu', () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⣿'); // braille art from the Banner
    expect(frame.indexOf('⣿')).toBeLessThan(frame.indexOf('prwatch'));
  });

  it('renders the ASCII PR WATCH title under the art', () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('@@@@@@@  @@@@@@@'); // first line of the PR WATCH lettering
    expect(frame.indexOf('⣿')).toBeLessThan(frame.indexOf('@@@@@@@'));
  });

  it('shows watched repos count from config', () => {
    const { lastFrame } = render(
      <App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b', 'c/d'] }} />,
    );
    expect(lastFrame()).toContain('2 repo');
  });

  it('shows an error instead of crashing when state.json is corrupt', async () => {
    await fs.writeFile(path.join(tmp, 'state.json'), '{invalid json}');

    const { stdin, lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('\r'); // Status is the first menu item
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toMatch(/invalid state/);
  });
});
