import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadConfig } from '../config.js';
import { ensureDirs } from '../paths.js';
import { ensureHomeRubric } from '../rubric.js';

export async function runTui(): Promise<void> {
  await ensureDirs();
  await ensureHomeRubric();
  const config = await loadConfig();
  render(React.createElement(App, { initialConfig: config }));
}
