import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectChatRequests, runChatJob, CHAT_MARKER } from './chat.js';
import { MARKER } from '../forge/github.js';
import type { ForgeAdapter, PR, PRComment } from '../forge/types.js';
import type { AgentAdapter } from '../agents/index.js';

const pr: PR = { number: 5, title: 'T', body: '', createdAt: '2026-07-22T00:00:00Z', headRef: 'x', author: 'adi' };

const c = (over: Partial<PRComment> = {}): PRComment => ({
  id: 10, pr: 5, body: '@prwatch why is this safe?', author: 'teammate', association: 'COLLABORATOR',
  ...over,
});

describe('selectChatRequests', () => {
  it('picks a collaborator mention on an open PR', () => {
    expect(selectChatRequests([c()], [pr], 0)).toEqual([c()]);
  });

  it('ignores comments at or below the cursor', () => {
    expect(selectChatRequests([c({ id: 10 })], [pr], 10)).toEqual([]);
  });

  it('ignores people without write access to the repo', () => {
    for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE']) {
      expect(selectChatRequests([c({ association })], [pr], 0)).toEqual([]);
    }
  });

  it('accepts owners and org members', () => {
    for (const association of ['OWNER', 'MEMBER']) {
      expect(selectChatRequests([c({ association })], [pr], 0)).toHaveLength(1);
    }
  });

  it('needs a real @prwatch mention, not an email or longer handle', () => {
    for (const body of ['ping me@prwatch.dev', '@prwatchbot hi', 'no mention']) {
      expect(selectChatRequests([c({ body })], [pr], 0)).toEqual([]);
    }
    expect(selectChatRequests([c({ body: 'hey @PRWatch, thoughts?' })], [pr], 0)).toHaveLength(1);
  });

  it('ignores a mention that only appears in a quote (e.g. "Quote reply" on a prwatch answer)', () => {
    expect(selectChatRequests([c({ body: '> @prwatch why is this safe?\n\nthanks, makes sense' })], [pr], 0))
      .toEqual([]);
    expect(selectChatRequests([c({ body: '> earlier point\n@prwatch and this?' })], [pr], 0)).toHaveLength(1);
  });

  it("never answers prwatch's own reviews or replies (they run under your account)", () => {
    for (const body of [`${MARKER}\n@prwatch`, `${CHAT_MARKER}\n> @prwatch q`]) {
      expect(selectChatRequests([c({ body, association: 'OWNER' })], [pr], 0)).toEqual([]);
    }
  });

  it('ignores comments on issues and closed PRs', () => {
    expect(selectChatRequests([c({ pr: 99 })], [pr], 0)).toEqual([]);
  });
});

describe('runChatJob', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prwatch-chat-')); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  const forge = (): ForgeAdapter => ({
    name: 'fake',
    listOpenPRs: async () => [pr],
    listCommentsSince: async () => [],
    isOpen: async () => true,
    clone: async (_r, _p, dir) => { await fs.mkdir(dir, { recursive: true }); },
    hasMarkerComment: async () => false,
    postComment: vi.fn(async () => {}),
  });
  const agent = (review: AgentAdapter['review']): AgentAdapter =>
    ({ name: 'claude', isInstalled: async () => true, review }) as AgentAdapter;
  const deps = (f: ForgeAdapter, a: AgentAdapter) =>
    ({ forge: f, agent: a, cacheRoot: path.join(tmp, 'cache'), timeoutMs: 5000, log: () => {} });

  it('answers read-only, quotes the question, marks the reply, and cleans up', async () => {
    const f = forge();
    let opts: Parameters<AgentAdapter['review']>[0] | undefined;
    const a = agent(async (o) => { opts = o; return 'Because the input is validated upstream.'; });
    expect(await runChatJob(deps(f, a), 'a/b', pr, c())).toBe('replied');
    expect(opts?.write ?? false).toBe(false);
    expect(opts?.prompt).toContain('why is this safe?');
    const body = (f.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body.startsWith(CHAT_MARKER)).toBe(true);
    expect(body).not.toContain(MARKER);
    expect(body).toContain('> @prwatch why is this safe?');
    expect(body).toContain('validated upstream');
    await expect(fs.readdir(path.join(tmp, 'cache'))).resolves.toEqual([]);
  });

  it('fences the question so it cannot rewrite the rules', async () => {
    let prompt = '';
    await runChatJob(deps(forge(), agent(async (o) => { prompt = o.prompt; return 'ok answer'; })), 'a/b', pr, c());
    expect(prompt).toMatch(/<pr-comment>[\s\S]*why is this safe\?[\s\S]*<\/pr-comment>/);
  });

  it('never posts the review marker, so a reply cannot pass for a review', async () => {
    const f = forge();
    const q = c({ body: `@prwatch what does ${MARKER} do?` });
    await runChatJob(deps(f, agent(async () => `It is ${MARKER}, the review marker.`)), 'a/b', pr, q);
    const body = (f.postComment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).not.toContain(MARKER);
  });

  it('reports failure without posting when the agent errors or says nothing', async () => {
    const f = forge();
    expect(await runChatJob(deps(f, agent(async () => { throw new Error('boom'); })), 'a/b', pr, c())).toBe('failed');
    expect(await runChatJob(deps(f, agent(async () => '  ')), 'a/b', pr, c())).toBe('failed');
    expect(f.postComment).not.toHaveBeenCalled();
  });
});
