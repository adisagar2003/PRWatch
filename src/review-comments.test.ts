import { describe, it, expect } from 'vitest';
import {
  splitReview, commentableLines, keepInDiff, formatCommentBody, MAX_LINE_COMMENTS,
} from './review-comments.js';

const block = (json: string) => `\n\n\`\`\`prwatch-comments\n${json}\n\`\`\`\n`;

describe('splitReview', () => {
  it('pulls the line comments out and leaves the markdown review', () => {
    const out = splitReview('# Summary\nok' + block('[{"path":"a.ts","line":3,"body":"x"}]'));
    expect(out.summary).toBe('# Summary\nok');
    expect(out.comments).toEqual([{ path: 'a.ts', line: 3, body: 'x' }]);
  });

  it('returns no comments and the whole text when there is no block', () => {
    expect(splitReview('# Summary')).toEqual({ summary: '# Summary', comments: [], error: undefined });
  });

  it('strips a malformed block and reports why, so junk never reaches the PR', () => {
    const out = splitReview('# S' + block('[{oops'));
    expect(out.summary).toBe('# S');
    expect(out.comments).toEqual([]);
    expect(out.error).toMatch(/JSON/);
  });

  it('drops entries with the wrong shape but keeps valid ones', () => {
    const json = JSON.stringify([
      { path: 'a.ts', line: 1, body: 'ok', suggestion: 'const x = 1;', startLine: 1 },
      { path: 'a.ts', line: '2', body: 'line is a string' },
      { path: 'a.ts', line: 0, body: 'line must be ≥ 1' },
      { path: '', line: 4, body: 'empty path' },
      { path: 'a.ts', line: 5 },
      { path: 'a.ts', line: 5, startLine: 7, body: 'start after end' },
    ]);
    expect(splitReview('# S' + block(json)).comments).toEqual([
      { path: 'a.ts', line: 1, body: 'ok', suggestion: 'const x = 1;', startLine: 1 },
    ]);
  });

  it(`caps the count at ${MAX_LINE_COMMENTS}`, () => {
    const many = Array.from({ length: MAX_LINE_COMMENTS + 5 }, (_, i) => ({ path: 'a.ts', line: i + 1, body: 'b' }));
    expect(splitReview('# S' + block(JSON.stringify(many))).comments).toHaveLength(MAX_LINE_COMMENTS);
  });
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 keep1
-old
+new2
+new3
 keep4
@@ -20,2 +21,2 @@ function f() {
 ctx21
-gone
+added22
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;

describe('commentableLines', () => {
  it('collects new-side line numbers of added and context lines per file', () => {
    const m = commentableLines(DIFF);
    expect([...m.get('src/a.ts')!].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 21, 22]);
    expect(m.has('gone.ts')).toBe(false);
  });

  it('reads paths git quotes or tab-terminates, so those files still get comments', () => {
    const d = (header: string) => `diff --git x y\n--- a/x\n${header}\n@@ -1,1 +1,1 @@\n+x\n`;
    expect([...commentableLines(d('+++ "b/caf\\303\\251 \\"q\\".ts"')).keys()]).toEqual(['café "q".ts']);
    expect([...commentableLines(d('+++ b/my file.ts\t')).keys()]).toEqual(['my file.ts']);
  });
});

describe('keepInDiff', () => {
  it('keeps comments whose whole range is commentable', () => {
    const m = commentableLines(DIFF);
    const ok = { path: 'src/a.ts', line: 3, startLine: 2, body: 'b' };
    const outside = { path: 'src/a.ts', line: 10, body: 'b' };
    const split = { path: 'src/a.ts', line: 21, startLine: 4, body: 'spans hunks' };
    const otherFile = { path: 'nope.ts', line: 1, body: 'b' };
    expect(keepInDiff([ok, outside, split, otherFile], m)).toEqual({ kept: [ok], dropped: 3 });
  });
});

describe('formatCommentBody', () => {
  it('adds a GitHub suggestion block when there is a fix', () => {
    expect(formatCommentBody({ path: 'a', line: 1, body: 'Use const', suggestion: 'const x = 1;' }))
      .toBe('Use const\n\n```suggestion\nconst x = 1;\n```');
  });

  it('fences the suggestion longer than any backtick run inside it, so it cannot close early', () => {
    expect(formatCommentBody({ path: 'a', line: 1, body: 'b', suggestion: '```js\nx\n```' }))
      .toBe('b\n\n````suggestion\n```js\nx\n```\n````');
  });

  it('is just the body without a fix', () => {
    expect(formatCommentBody({ path: 'a', line: 1, body: 'Why?' })).toBe('Why?');
  });
});
