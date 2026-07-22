import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeAgent, agents, getAgent } from './index.js';

let tmp: string;

async function writeScript(name: string, body: string): Promise<string> {
  const p = path.join(tmp, name);
  await fs.writeFile(p, `#!/bin/sh\n${body}\n`);
  await fs.chmod(p, 0o755);
  return p;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('agent adapters', () => {
  it('review returns stdout of the agent binary', async () => {
    const bin = await writeScript('fake-agent', 'echo "Verdict: APPROVE"');
    const agent = makeAgent('claude', bin, (p) => [p]);
    const out = await agent.review({ cwd: tmp, prompt: 'hi', timeoutMs: 5000 });
    expect(out.trim()).toBe('Verdict: APPROVE');
  });

  it('review passes the prompt through buildArgs', async () => {
    const bin = await writeScript('echo-args', 'echo "$2"');
    const agent = makeAgent('claude', bin, (p) => ['-p', p]);
    const out = await agent.review({ cwd: tmp, prompt: 'THE PROMPT', timeoutMs: 5000 });
    expect(out.trim()).toBe('THE PROMPT');
  });

  it('review rejects on non-zero exit', async () => {
    const bin = await writeScript('crasher', 'echo boom >&2; exit 1');
    const agent = makeAgent('codex', bin, (p) => [p]);
    await expect(agent.review({ cwd: tmp, prompt: 'x', timeoutMs: 5000 })).rejects.toThrow(/exited 1/);
  });

  it('review kills a hanging agent at the timeout', async () => {
    const bin = await writeScript('hanger', 'sleep 30');
    const agent = makeAgent('opencode', bin, (p) => [p]);
    await expect(agent.review({ cwd: tmp, prompt: 'x', timeoutMs: 300 })).rejects.toThrow(/timeout/);
  }, 10_000);

  it('isInstalled is false for a missing binary', async () => {
    const agent = makeAgent('claude', 'definitely-not-a-real-binary-xyz', (p) => [p]);
    expect(await agent.isInstalled()).toBe(false);
  });

  it('registry exposes all three agents', () => {
    expect(agents.map((a) => a.name).sort()).toEqual(['claude', 'codex', 'opencode']);
    expect(getAgent('codex').name).toBe('codex');
  });
});
