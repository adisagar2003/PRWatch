import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { listUserRepos } from '../forge/github.js';
import { fuzzyFilter } from './fuzzy.js';
import { ui } from './ui.js';
import { Panel, useTerminalWidth } from './chrome.js';

const VISIBLE = 8;

/**
 * Add-repo screen: fuzzy-pick from the user's GitHub repos. Falls back to a
 * plain owner/name text input when `gh` can't list repos or none are available.
 */
export function RepoPicker({
  existing,
  onDone,
}: {
  existing: string[];
  onDone: (repo: string | null) => void;
}) {
  const [repos, setRepos] = useState<string[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  const width = Math.max(40, useTerminalWidth() - 2);

  useEffect(() => {
    let alive = true;
    listUserRepos()
      .then((all) => {
        if (!alive) return;
        setRepos(all.filter((r) => !existing.includes(r)));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [existing]);

  if (failed) return <ManualEntry reason="couldn't list your repos via gh" onDone={onDone} />;
  if (repos === null)
    return (
      <Panel title="add a repo" width={width}>
        <Text dimColor>loading your repos…</Text>
      </Panel>
    );
  if (repos.length === 0)
    return <ManualEntry reason="no new repos found to pick from" onDone={onDone} />;

  return <Picker repos={repos} onDone={onDone} />;
}

function Picker({ repos, onDone }: { repos: string[]; onDone: (repo: string | null) => void }) {
  const width = Math.max(40, useTerminalWidth() - 2);
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);

  const matches = useMemo(() => fuzzyFilter(filter, repos), [filter, repos]);

  // Keep the cursor inside the (shrinking/growing) match list as you type.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(matches.length - 1, c + 1));
    if (key.return && matches.length > 0) onDone(matches[cursor]);
  });

  // Scroll a VISIBLE-row window so the cursor stays on screen.
  const start = Math.min(Math.max(0, cursor - VISIBLE + 1), Math.max(0, matches.length - VISIBLE));
  const window = matches.slice(start, start + VISIBLE);

  return (
    <Panel title={`add a repo · ${matches.length}/${repos.length}`} width={width}>
      <Box>
        <Text color={ui.info}>filter </Text>
        <Text dimColor>❯ </Text>
        <TextInput value={filter} onChange={setFilter} placeholder="type to fuzzy-find…" />
      </Box>
      {matches.length === 0 && <Text dimColor>no match</Text>}
      {window.map((repo, i) => {
        const selected = start + i === cursor;
        return (
          <Text key={repo} color={selected ? 'cyan' : undefined} bold={selected} dimColor={!selected}>
            {selected ? '❯ ' : '  '}
            {repo}
          </Text>
        );
      })}
    </Panel>
  );
}

function ManualEntry({ reason, onDone }: { reason: string; onDone: (repo: string | null) => void }) {
  const width = Math.max(40, useTerminalWidth() - 2);
  const [value, setValue] = useState('');
  return (
    <Panel title="add a repo" width={width} color={ui.warn}>
      <Text color={ui.warn}>⚠ {reason} — enter it manually</Text>
      <Box>
        <Text color={ui.info}>owner/name </Text>
        <Text dimColor>❯ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={(v) => onDone(v.trim() || null)} />
      </Box>
    </Panel>
  );
}
