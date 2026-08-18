import { describe, it, expect } from 'vitest';
import { notifyCommand } from './notify.js';

describe('notifyCommand', () => {
  it('uses osascript on macOS with the title and message', () => {
    const cmd = notifyCommand('darwin', 'PRWatch', 'posted review for a/b#42');
    expect(cmd).toEqual({
      bin: 'osascript',
      args: ['-e', 'display notification "posted review for a/b#42" with title "PRWatch"'],
    });
  });

  it('escapes quotes and backslashes so a PR title cannot break out of the AppleScript string', () => {
    const cmd = notifyCommand('darwin', 'PRWatch', 'a/b#42 · fix "quoted" C:\\path');
    expect(cmd!.args[1]).toBe(
      'display notification "a/b#42 · fix \\"quoted\\" C:\\\\path" with title "PRWatch"',
    );
  });

  it('uses notify-send on Linux, passing text as separate argv entries', () => {
    expect(notifyCommand('linux', 'PRWatch', 'a/b#42 · "quoted"')).toEqual({
      bin: 'notify-send',
      args: ['PRWatch', 'a/b#42 · "quoted"'],
    });
  });

  it('collapses newlines and control characters that would break the AppleScript statement', () => {
    const cmd = notifyCommand('darwin', 'PRWatch', 'a/b#1 · title\nwith\r\nbreaks\tand\u0007bell');
    expect(cmd!.args[1]).toBe(
      'display notification "a/b#1 · title with breaks and bell" with title "PRWatch"',
    );
  });

  it('truncates an over-long message instead of handing the notifier a wall of text', () => {
    const cmd = notifyCommand('linux', 'PRWatch', 'x'.repeat(300));
    expect(cmd!.args[1]).toHaveLength(200);
    expect(cmd!.args[1].endsWith('…')).toBe(true);
  });

  it('returns null on platforms with no notifier', () => {
    expect(notifyCommand('win32', 'PRWatch', 'hi')).toBeNull();
  });
});
