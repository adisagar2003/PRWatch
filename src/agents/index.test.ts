import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeAgent, agents, getAgent } from './index.js';
import { killActiveProcessGroups } from '../run-command.js';

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

  it('kills the whole process tree on timeout', async () => {
    const pidFile = path.join(tmp, 'grandchild.pid');
    const bin = await writeScript('forker', `sleep 30 &\necho $! > ${pidFile}\nwait`);
    const agent = makeAgent('claude', bin, (p) => [p]);
    await expect(agent.review({ cwd: tmp, prompt: 'x', timeoutMs: 500 })).rejects.toThrow(/timeout/);
    await new Promise((r) => setTimeout(r, 200)); // let SIGKILL land
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: grandchild is gone
  }, 10_000);

  it('isInstalled is false for a missing binary', async () => {
    const agent = makeAgent('claude', 'definitely-not-a-real-binary-xyz', (p) => [p]);
    expect(await agent.isInstalled()).toBe(false);
  });

  it('checkAuth reports missing when the binary is not on PATH', async () => {
    const agent = makeAgent('claude', 'definitely-not-a-real-binary-xyz', (p) => [p], {
      args: ['login', 'status'],
    });
    expect(await agent.checkAuth()).toBe('missing');
  });

  it('checkAuth reports ok when the auth command exits zero', async () => {
    const bin = await writeScript('authed', 'echo "Logged in using ChatGPT"');
    const agent = makeAgent('codex', bin, (p) => [p], { args: ['login', 'status'] });
    expect(await agent.checkAuth()).toBe('ok');
  });

  it('checkAuth reports not-authed when the auth command fails', async () => {
    const bin = await writeScript('logged-out', 'echo "not logged in" >&2; exit 1');
    const agent = makeAgent('codex', bin, (p) => [p], { args: ['login', 'status'] });
    expect(await agent.checkAuth()).toBe('not-authed');
  });

  it('checkAuth reports unknown for an agent with no auth command', async () => {
    const bin = await writeScript('no-auth-cmd', 'echo hi');
    const agent = makeAgent('claude', bin, (p) => [p]);
    expect(await agent.checkAuth()).toBe('unknown');
  });

  it('checkAuth honours an output predicate, so zero credentials is not "ok"', async () => {
    const bin = await writeScript('empty-creds', 'echo "0 credentials"');
    const agent = makeAgent('opencode', bin, (p) => [p], {
      args: ['auth', 'list'],
      ok: (out) => /[1-9]\d* credential/.test(out),
    });
    expect(await agent.checkAuth()).toBe('not-authed');
  });

  it('registry wires an auth check for codex and opencode', () => {
    expect(getAgent('codex').hasAuthCheck).toBe(true);
    expect(getAgent('opencode').hasAuthCheck).toBe(true);
    expect(getAgent('claude').hasAuthCheck).toBe(false);
  });

  it('registry exposes all three agents', () => {
    expect(agents.map((a) => a.name).sort()).toEqual(['claude', 'codex', 'opencode']);
    expect(getAgent('codex').name).toBe('codex');
  });

  it('killActiveProcessGroups kills a hanging in-flight review', async () => {
    const bin = await writeScript('hanger2', 'sleep 30');
    const agent = makeAgent('claude', bin, (p) => [p]);
    const pending = agent.review({ cwd: tmp, prompt: 'x', timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 150));
    killActiveProcessGroups();
    await expect(pending).rejects.toThrow(/exited|killed/);
  }, 10_000);
});
