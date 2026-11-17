import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { BBox, Segs, Spinner, cell, dot, fitSegs, theme, type Seg } from './btop.js';
import { DAY_MS, ago, duration, inWindow, recentReviews, tally } from './data.js';
import { loadState, type ReviewRecord, type State } from '../state.js';
import { tailLog, parseLog, type LogEntry } from '../daemon/log.js';
import { checkGhAuth } from '../forge/github.js';
import { getAgent, type AgentAuth } from '../agents/index.js';
import type { Config } from '../config.js';

const REFRESH_MS = 2000;

export interface DaemonData {
  state: State | null;
  entries: LogEntry[];
  error: string | null;
  ghOk: boolean | null;
  agentAuth: AgentAuth | null;
}

/** Live state + log, polled every 2s; auth and scanner probes run once. */
export function useDaemonData(agent: Config['agent']): DaemonData {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ghOk, setGhOk] = useState<boolean | null>(null);
  const [agentAuth, setAgentAuth] = useState<AgentAuth | null>(null);

  useEffect(() => {
    checkGhAuth().then(setGhOk).catch(() => setGhOk(false));
  }, []);

  useEffect(() => {
    let alive = true;
    setAgentAuth(null);
    getAgent(agent)
      .checkAuth()
      .then((a) => alive && setAgentAuth(a))
      .catch(() => alive && setAgentAuth('unknown'));
    return () => {
      alive = false;
    };
  }, [agent]);

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
      tailLog(100)
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

  return { state, entries, error, ghOk, agentAuth };
}

export const reviewsOf = (data: DaemonData): ReviewRecord[] => recentReviews(data.state?.history ?? []);

export function isRunning(state: State | null, config: Config, now: Date): boolean {
  const t = state?.lastTickAt;
  return !!t && now.getTime() - Date.parse(t) < config.pollIntervalMinutes * 60_000 + 30_000;
}

export function Dashboard({
  config, data, selected, showLog, width, height, now,
}: {
  config: Config;
  data: DaemonData;
  selected: number;
  showLog: boolean;
  width: number;
  height: number;
  now: Date;
}) {
  const statusH = 5 + (problem(config, data) ? 1 : 0) + (data.error ? 1 : 0);
  const listH = Math.max(4, height - statusH);
  return (
    <Box flexDirection="column" width={width}>
      <StatusBox config={config} data={data} width={width} height={statusH} now={now} />
      {showLog
        ? <LogBox data={data} width={width} height={listH} />
        : <ReviewsBox data={data} selected={selected} width={width} height={listH} now={now} />}
    </Box>
  );
}

/** The one thing to fix first, if anything is broken. */
function problem(config: Config, data: DaemonData): string | undefined {
  if (data.ghOk === false) return 'gh is not logged in → gh auth login';
  const a = data.agentAuth;
  if (a === 'missing') return `${config.agent} is not installed`;
  if (a === 'not-authed') return `${config.agent} is not logged in → ${getAgent(config.agent).loginHint ?? `log in to ${config.agent}`}`;
  return undefined;
}

// ── status ───────────────────────────────────────────────────────────────────
function StatusBox({ config, data, width, height, now }: {
  config: Config; data: DaemonData; width: number; height: number; now: Date;
}) {
  const inner = width - 4;
  const lastTick = data.state?.lastTickAt ?? null;
  const running = isRunning(data.state, config, now);
  const a = data.agentAuth;
  const sep: Seg = { text: '   ', color: theme.dim };

  const health: Seg[] = [
    dot(lastTick === null ? false : running),
    { text: lastTick === null ? ' daemon not started' : running ? ' daemon up' : ` daemon stopped ${ago(lastTick, now)} ago`, color: theme.text },
    sep,
    dot(data.ghOk),
    { text: ' gh', color: theme.text },
    sep,
    dot(a === null || a === 'unknown' ? null : a === 'ok'),
    { text: ` ${config.agent}`, color: theme.text },
    sep,
    { text: 'conflict auto-fix ', color: theme.dim },
    { text: config.autoResolveConflicts ? 'on' : 'off', color: config.autoResolveConflicts ? theme.ok : theme.dim },
  ];

  const active = data.state?.active ?? null;
  const fix = problem(config, data);
  const t = tally(inWindow(data.state?.history ?? [], now, DAY_MS));

  return (
    <BBox title="status" width={width} height={height} right={now.toTimeString().slice(0, 5)}>
      <Text wrap="truncate"><Segs segs={fitSegs(health, inner)} /></Text>
      {fix && <Text color={theme.warn} wrap="truncate">⚠ {fix}</Text>}
      {active ? (
        <Text wrap="truncate">
          <Spinner color={theme.warn} />
          <Text color={theme.warn}> {active.kind === 'conflict' ? 'resolving conflicts in' : active.rereview ? 're-reviewing' : 'reviewing'} </Text>
          <Text color={theme.title} bold>{active.repo}#{active.pr}</Text>
          <Text color={theme.text}> · {active.title}</Text>
          <Text color={theme.dim}> · {duration(now.getTime() - Date.parse(active.startedAt))}</Text>
        </Text>
      ) : (
        <Text color={theme.dim} wrap="truncate">
          {lastTick === null ? 'run `prw daemon` (or press i to install it as a service) to start watching'
            : running ? `waiting for new PRs on ${config.repos.length} repo${config.repos.length === 1 ? '' : 's'} · checks every ${config.pollIntervalMinutes}m`
              : 'the daemon is not running · start it with `prw daemon`'}
        </Text>
      )}
      <Text wrap="truncate">
        <Text color={theme.dim}>last 24h  </Text>
        <Text color={theme.title} bold>{t.reviews}</Text>
        <Text color={theme.dim}> reviews · </Text>
        <Text color={t.rereviews ? theme.text : theme.dim}>{t.rereviews} re-reviews</Text>
        <Text color={theme.dim}> · </Text>
        <Text color={t.resolved ? theme.ok : theme.dim}>{t.resolved} conflicts fixed</Text>
        {t.failed > 0 && <Text color={theme.bad}> · {t.failed} failed</Text>}
      </Text>
      {data.error && <Text color={theme.bad} wrap="truncate">⚠ {data.error}</Text>}
    </BBox>
  );
}

// ── reviews ──────────────────────────────────────────────────────────────────
const BADGE: Record<string, Seg> = {
  posted: { text: ' REVIEW ', color: theme.accent, bold: true },
  rereview: { text: ' RE-REV ', color: '#e879f9', bold: true },
  resolved: { text: ' FIXED  ', color: theme.ok, bold: true },
  failed: { text: ' FAIL   ', color: theme.bad, bold: true },
};
const badgeFor = (r: ReviewRecord): Seg =>
  r.outcome === 'posted' && r.rereview ? BADGE.rereview : BADGE[r.outcome] ?? BADGE.failed;

function ReviewsBox({ data, selected, width, height, now }: {
  data: DaemonData; selected: number; width: number; height: number; now: Date;
}) {
  const inner = width - 4;
  const list = reviewsOf(data);
  const rows = Math.max(0, height - 2);
  const sel = Math.min(selected, Math.max(0, list.length - 1));
  const top = Math.max(0, sel - rows + 1);
  const repoW = Math.min(34, Math.max(16, Math.floor(inner * 0.3)));
  const titleW = Math.max(0, inner - 5 - 9 - repoW - 1);

  return (
    <BBox title="reviews" width={width} height={height} right={list.length ? `${sel + 1}/${list.length}` : ''}>
      {list.length === 0 && <Text color={theme.dim}>no reviews yet · new PRs on watched repos show up here</Text>}
      {list.slice(top, top + rows).map((r, i) => {
        const on = top + i === sel;
        const bg = on ? theme.selBg : undefined;
        const fg = (c: string) => (on ? theme.selFg : c);
        const segs: Seg[] = [
          { text: cell(ago(r.at, now), 5), color: fg(theme.dim), bg },
          { ...badgeFor(r), bg, ...(on ? { color: theme.selFg } : {}) },
          { text: ' ', bg },
          { text: cell(`${r.repo}#${r.pr}`, repoW) + ' ', color: fg(theme.title), bg, bold: on },
          { text: cell(r.title, titleW), color: fg(theme.text), bg },
        ];
        return (
          <Text key={`${r.repo}#${r.pr}@${r.at}`} wrap="truncate">
            <Segs segs={fitSegs(segs, inner)} />
          </Text>
        );
      })}
    </BBox>
  );
}

// ── log ──────────────────────────────────────────────────────────────────────
function LogBox({ data, width, height }: { data: DaemonData; width: number; height: number }) {
  const recent = data.entries.slice(-Math.max(0, height - 2));
  const tone = (t: string) =>
    t.startsWith('FAILED') || t.includes('error') ? theme.bad
      : t.startsWith('posted') || t.startsWith('resolved') ? theme.ok
        : t.startsWith('reviewing') ? theme.warn
          : theme.text;
  return (
    <BBox title="log" width={width} height={height} right="~/.prwatch/logs/daemon.log">
      {recent.length === 0 && <Text color={theme.dim}>nothing logged yet</Text>}
      {recent.map((e, i) => (
        <Text key={i} wrap="truncate">
          <Text color={theme.dim}>{e.at.toTimeString().slice(0, 8)} </Text>
          <Text color={tone(e.text)}>{e.text}</Text>
        </Text>
      ))}
    </BBox>
  );
}
