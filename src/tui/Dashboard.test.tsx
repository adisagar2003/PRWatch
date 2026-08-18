import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { Dashboard } from './Dashboard.js';
import { DEFAULT_CONFIG } from '../config.js';

let tmp: string;

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const lines = (s: string | undefined): string[] => (s ?? '').replace(ANSI, '').split('\n');
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

const config = { ...DEFAULT_CONFIG, repos: ['adisagar2003/PRWatch', 'adisagar2003/groundwork'] };

describe('Dashboard layout', () => {
  it('never draws past the width it was given, even in a narrow terminal', async () => {
    const { lastFrame } = render(<Dashboard config={config} width={54} logHeight={3} />);
    await settle();
    for (const line of lines(lastFrame())) {
      expect(line.length).toBeLessThanOrEqual(54);
    }
  });

  it('stacks the daemon and agent panels below the two-column threshold', async () => {
    const narrow = render(<Dashboard config={config} width={54} logHeight={3} />);
    await settle();
    // Side by side, both titles share one row; stacked, they don't.
    const stackedRow = lines(narrow.lastFrame()).find((l) => l.includes('daemon') && l.includes('agent'));
    expect(stackedRow).toBeUndefined();

    const wide = render(<Dashboard config={config} width={120} logHeight={3} />);
    await settle();
    const sharedRow = lines(wide.lastFrame()).find((l) => l.includes('daemon') && l.includes('agent'));
    expect(sharedRow).toBeDefined();
  });
});
