import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config.js';

describe('App', () => {
  it('renders the main menu', () => {
    const { lastFrame } = render(<App initialConfig={{ ...DEFAULT_CONFIG }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('prwatch');
    expect(frame).toContain('Status');
    expect(frame).toContain('Repos');
    expect(frame).toContain('Agent');
    expect(frame).toContain('Install service');
    expect(frame).toContain('Quit');
  });

  it('shows watched repos count from config', () => {
    const { lastFrame } = render(
      <App initialConfig={{ ...DEFAULT_CONFIG, repos: ['a/b', 'c/d'] }} />,
    );
    expect(lastFrame()).toContain('2 repo');
  });
});
