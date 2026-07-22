import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRubric, ensureHomeRubric, DEFAULT_RUBRIC, LEGACY_DEFAULT_RUBRIC } from './rubric.js';
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

  it('ensureHomeRubric writes default once and never overwrites edits', async () => {
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe(DEFAULT_RUBRIC);
    await fs.writeFile(rubricPath(), 'edited');
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe('edited');
  });

  it('ensureHomeRubric migrates an un-customised legacy rubric to the new default', async () => {
    await fs.writeFile(rubricPath(), LEGACY_DEFAULT_RUBRIC);
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe(DEFAULT_RUBRIC);
  });

  it('ensureHomeRubric leaves a user-edited legacy rubric alone', async () => {
    const edited = LEGACY_DEFAULT_RUBRIC + '\n\nExtra house rule: no TODOs.\n';
    await fs.writeFile(rubricPath(), edited);
    await ensureHomeRubric();
    expect(await fs.readFile(rubricPath(), 'utf8')).toBe(edited);
  });

  it('DEFAULT_RUBRIC keeps the candid-review output contract', () => {
    // Assert the actual strings the rubric emits (bold list items, not ## headings),
    // so removing a required section or field fails the test.
    expect(DEFAULT_RUBRIC).toContain('# Code Review (Radical Candor)');
    expect(DEFAULT_RUBRIC).toContain('## Project standards');
    expect(DEFAULT_RUBRIC).toContain('**Confidence:** Safe ✓ | Verify ⚡ | Careful ⚠️');
    expect(DEFAULT_RUBRIC).toContain('**🔥 Critical Issues**');
    expect(DEFAULT_RUBRIC).toContain("**✅ What's Good**");
  });

  it('throws when repo rubric path is a directory', async () => {
    await fs.mkdir(path.join(clone, '.prwatch', 'rubric.md'), { recursive: true });
    await expect(resolveRubric(clone)).rejects.toMatchObject({
      message: expect.stringMatching(/rubric.*\.prwatch/),
    });
  });
});
