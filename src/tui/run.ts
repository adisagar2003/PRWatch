import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadConfig } from '../config.js';
import { ensureDirs } from '../paths.js';
import { ensureHomeRubric } from '../rubric.js';

// Alternate screen + hidden cursor, like btop: the dashboard owns the terminal and
// the shell's scrollback comes back untouched on quit.
const ENTER = '\x1b[?1049h\x1b[H\x1b[?25l';
const LEAVE = '\x1b[?25h\x1b[?1049l';

export async function runTui(): Promise<void> {
  await ensureDirs();
  await ensureHomeRubric();
  const config = await loadConfig();
  const tty = process.stdout.isTTY === true;
  if (tty) process.stdout.write(ENTER);
  const restore = () => {
    if (tty) process.stdout.write(LEAVE);
  };
  process.once('exit', restore);
  const app = render(React.createElement(App, { initialConfig: config }));
  await app.waitUntilExit();
  restore();
  process.removeListener('exit', restore);
}
