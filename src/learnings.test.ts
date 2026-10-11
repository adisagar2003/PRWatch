import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveLearnings, MAX_LEARNINGS_CHARS } from './learnings.js';
import { learningsPath } from './paths.js';

let tmp: string;
let clone: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
  clone = path.join(tmp, 'clone');
  await fs.mkdir(path.join(clone, '.prwatch'), { recursive: true });
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

const repoFile = () => path.join(clone, '.prwatch', 'learnings.md');

describe('resolveLearnings', () => {
  it('adds nothing when neither file exists', async () => {
    expect(await resolveLearnings(clone)).toBe('');
  });

  it('includes home and repo learnings, repo first', async () => {
    await fs.writeFile(learningsPath(), '- we use tabs');
    await fs.writeFile(repoFile(), '- no default exports');
    const out = await resolveLearnings(clone);
    expect(out).toContain('- we use tabs');
    expect(out).toContain('- no default exports');
    expect(out.indexOf('no default exports')).toBeLessThan(out.indexOf('we use tabs'));
    expect(out).toMatch(/do not report/i);
  });

  it('ignores files that are only whitespace', async () => {
    await fs.writeFile(learningsPath(), '  \n\n');
    expect(await resolveLearnings(clone)).toBe('');
  });

  it('caps each file so the prompt cannot grow without bound', async () => {
    await fs.writeFile(learningsPath(), 'x'.repeat(MAX_LEARNINGS_CHARS + 500));
    const out = await resolveLearnings(clone);
    expect(out).toContain('(truncated)');
    expect(out.length).toBeLessThan(MAX_LEARNINGS_CHARS + 500);
  });

  it('throws a clear error when a learnings path is unreadable', async () => {
    await fs.mkdir(learningsPath());
    await expect(resolveLearnings(clone)).rejects.toThrow(/learnings/);
  });
});
