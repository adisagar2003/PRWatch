import { spawn } from 'node:child_process';

/** Open a URL in the default browser, fire-and-forget. Only ever called with github.com PR URLs we build. */
export function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // No opener available: nothing useful to do from inside the TUI.
  }
}
