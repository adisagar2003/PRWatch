import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt.js';
import type { PR } from './forge/types.js';

const pr: PR = {
  number: 42, title: 'Add login', body: 'Implements JWT login',
  createdAt: '2026-07-21T10:00:00Z', headRef: 'feat/login', author: 'adi',
};

describe('buildPrompt', () => {
  it('includes repo, PR number/title, body, and rubric', () => {
    const p = buildPrompt('MY RUBRIC', 'a/b', pr);
    expect(p).toContain('a/b');
    expect(p).toContain('#42');
    expect(p).toContain('Add login');
    expect(p).toContain('Implements JWT login');
    expect(p).toContain('MY RUBRIC');
  });

  it('handles empty PR body', () => {
    expect(buildPrompt('R', 'a/b', { ...pr, body: '' })).toContain('(no description)');
  });
});
