import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRubric, ensureHomeRubric, DEFAULT_RUBRIC } from './rubric.js';
import { rubricPath } from './paths.js';

let tmp: string;
let clone: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
  process.env.PRWATCH_HOME = tmp;
  clone = path.join(tmp, 'clone');
  await fs.mkdir(clone, { recursive: true });
});

afterEach(async () => {
  delete process.env.PRWATCH_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('resolveRubric', () => {
  it('falls back to DEFAULT_RUBRIC when nothing on disk', async () => {
    expect(await resolveRubric(clone)).toBe(DEFAULT_RUBRIC);
  });

  it('prefers home rubric over default', async () => {
    await fs.writeFile(rubricPath(), 'home rubric');
    expect(await resolveRubric(clone)).toBe('home rubric');
  });

  it('prefers repo .prwatch/rubric.md over home rubric', async () => {
    await fs.writeFile(rubricPath(), 'home rubric');
    await fs.mkdir(path.join(clone, '.prwatch'), { recursive: true });
    await fs.writeFile(path.join(clone, '.prwatch', 'rubric.md'), 'repo rubric');
    expect(await resolveRubric(clone)).toBe('repo rubric');
  });

  it('ensureHomeRubric writes default once and never overwrites', async () => {
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe(DEFAULT_RUBRIC);
    await fs.writeFile(rubricPath(), 'edited');
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe('edited');
  });
});
