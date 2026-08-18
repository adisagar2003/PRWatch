import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ui, StatusDot } from './ui.js';
import { Panel, bar, sparkline } from './chrome.js';
import { loadState, type State } from '../state.js';
import { tailLog, parseLog, reviewHistogram, type LogEntry } from '../daemon/log.js';
import { checkGhAuth } from '../forge/github.js';
import type { Config } from '../config.js';

const REFRESH_MS = 2000;
const BUCKET_MS = 600_000; // one graph column per 10 minutes
const TAIL_LINES = 400; // read enough history to fill the graph
const TWO_COL_MIN = 88;

function agoLabel(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 90) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/** Live state + log, polled while the dashboard is mounted. */
function useDaemonData() {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ghOk, setGhOk] = useState<boolean | null>(null);

  // gh auth is slow and rarely changes — check it once.
  useEffect(() => {
    checkGhAuth()
      .then(setGhOk)
      .catch(() => setGhOk(false));
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadState()
        .then((s) => {
          if (!alive) return;
          setState(s);
          setError(null);
        })
        .catch((e) => alive && setError((e as Error).message));
      tailLog(TAIL_LINES)
        .then((l) => alive && setEntries(parseLog(l)))
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { state, entries, error, ghOk };
}

export function Dashboard({
  config,
  width,
  logHeight,
}: {
  config: Config;
  width: number;
  logHeight: number;
}) {
  const { state, entries, error, ghOk } = useDaemonData();
  const twoCol = width >= TWO_COL_MIN;
  const leftWidth = twoCol ? Math.floor(width / 2) : width;
  const rightWidth = twoCol ? width - leftWidth : width;

  const lastTick = state?.lastTickAt ?? null;
  // "Running" means it ticked within one poll interval, plus slack for a slow review.
  const running =
    lastTick !== null &&
    Date.now() - Date.parse(lastTick) < config.pollIntervalMinutes * 60_000 + 30_000;

  return (
    <Box flexDirection="column">
      <Box flexDirection={twoCol ? 'row' : 'column'}>
        <Panel title="daemon" hotkey="1" width={leftWidth}>
          <Text>
            <StatusDot ok={running} />{' '}
            {lastTick === null
              ? 'never ticked · run `prw daemon`'
              : running
                ? `running · tick ${agoLabel(lastTick)}`
                : `stopped · last tick ${agoLabel(lastTick)}`}
          </Text>
          <Text dimColor>
            poll {config.pollIntervalMinutes}m · timeout {config.agentTimeoutMinutes}m
          </Text>
          {error !== null && <Text color={ui.error}>⚠ {error}</Text>}
        </Panel>
        <Panel title="agent" hotkey="2" width={rightWidth}>
          <Text>
            <StatusDot ok={ghOk} /> gh auth{' '}
            {ghOk === null ? 'checking…' : ghOk ? 'OK' : 'NOT LOGGED IN — `gh auth login`'}
          </Text>
          <Text dimColor>
            reviewing with <Text color={ui.info}>{config.agent}</Text>
          </Text>
        </Panel>
      </Box>

      <Panel title="repos" hotkey="3" width={width}>
        <RepoTable config={config} state={state} width={width - 4} />
      </Panel>

      <Panel title="activity" hotkey="4" width={width}>
        <Activity entries={entries} width={width - 4} logHeight={logHeight} />
      </Panel>
    </Box>
  );
}

function RepoTable({
  config,
  state,
  width,
}: {
  config: Config;
  state: State | null;
  width: number;
}) {
  if (config.repos.length === 0) return <Text dimColor>(no repos watched — press 3 to add one)</Text>;

  const nameWidth = Math.min(36, Math.max(6, ...config.repos.map((r) => r.length)));
  const counts = config.repos.map((r) => state?.repos[r]?.reviewed.length ?? 0);
  const peak = Math.max(1, ...counts);
  const meterWidth = Math.max(0, width - nameWidth - 20);
  const cell = (n: number) => String(n).padStart(5);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {'repo'.padEnd(nameWidth)} {'revd'.padStart(5)} {'fail'.padStart(5)} {'retry'.padStart(5)}
      </Text>
      {config.repos.map((repo) => {
        const rs = state?.repos[repo];
        const reviewed = rs?.reviewed.length ?? 0;
        const failed = rs?.failed.length ?? 0;
        const pending = rs ? Object.keys(rs.retries).length : 0;
        return (
          <Text key={repo}>
            {repo.slice(0, nameWidth).padEnd(nameWidth)}{' '}
            <Text color={ui.success}>{cell(reviewed)}</Text>{' '}
            <Text color={failed > 0 ? ui.error : undefined}>{cell(failed)}</Text>{' '}
            <Text color={pending > 0 ? ui.warn : undefined}>{cell(pending)}</Text>{' '}
            <Text color={ui.success}>{bar(reviewed, peak, meterWidth)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function Activity({
  entries,
  width,
  logHeight,
}: {
  entries: LogEntry[];
  width: number;
  logHeight: number;
}) {
  const buckets = Math.max(10, Math.min(60, width - 24));
  const histogram = reviewHistogram(entries, new Date(), BUCKET_MS, buckets);
  const posted = histogram.reduce((a, b) => a + b, 0);
  const recent = entries.slice(-logHeight);

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>reviews/10m </Text>
        <Text color={ui.accent}>{sparkline(histogram)}</Text>
        <Text dimColor> {posted} in {(buckets * BUCKET_MS) / 3_600_000 | 0}h</Text>
      </Text>
      {recent.length === 0 && <Text dimColor>(no activity logged yet)</Text>}
      {recent.map((e, i) => (
        <Text key={i} dimColor wrap="truncate-end">
          <Text color={ui.border}>{e.at.toTimeString().slice(0, 8)}</Text> {e.text.slice(0, width - 10)}
        </Text>
      ))}
    </Box>
  );
}
