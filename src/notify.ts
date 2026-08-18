import { spawn } from 'node:child_process';

export interface NotifyCommand {
  bin: string;
  args: string[];
}

const MAX_MESSAGE_CHARS = 200;

/** PR titles are attacker-controlled: no control chars, no line breaks, no walls of text. */
function sanitize(s: string): string {
  const flat = s.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_MESSAGE_CHARS ? `${flat.slice(0, MAX_MESSAGE_CHARS - 1)}…` : flat;
}

/** The OS notifier for `platform`, or null where we have none. */
export function notifyCommand(
  platform: NodeJS.Platform,
  title: string,
  message: string,
): NotifyCommand | null {
  title = sanitize(title);
  message = sanitize(message);
  if (platform === 'darwin') {
    // AppleScript is a string literal, not argv — escape before interpolating.
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      bin: 'osascript',
      args: ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`],
    };
  }
  if (platform === 'linux') return { bin: 'notify-send', args: [title, message] };
  return null;
}

/** Fire-and-forget desktop notification. Never throws, never blocks the daemon. */
export function notify(title: string, message: string): void {
  const cmd = notifyCommand(process.platform, title, message);
  if (!cmd) return;
  try {
    spawn(cmd.bin, cmd.args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* no notifier installed — not worth failing a review over */
  }
}
