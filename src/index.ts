#!/usr/bin/env node
import { startDaemon } from './daemon/loop.js';

const [, , cmd, sub] = process.argv;

if (cmd === 'daemon') {
  await startDaemon();
} else if (cmd === 'service' && sub === 'install') {
  const { installService } = await import('./service.js');
  console.log(`service installed: ${await installService()}`);
} else {
  console.log('TUI: implemented in a later task. Run `prw daemon` to start the watcher.');
}
