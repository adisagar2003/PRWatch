import { describe, it, expect } from 'vitest';

// Smoke test that proves the CI workflow actually runs the suite and reports
// pass/fail. It is intentionally trivial: its only job is to exercise the
// red -> green path through GitHub Actions.
describe('ci smoke', () => {
  it('adds numbers', () => {
    expect(1 + 1).toBe(2);
  });
});
