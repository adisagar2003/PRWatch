import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { BBox, Graph, Segs, Spinner, cell, dot, fitSegs, hint, meterSegs, theme, type Seg } from './btop.js';
import {
  WINDOWS, ago, duration, filterReviews, histogram, inWindow, lastByRepo, resample, sortReviews, tally,
  type SortKey,
} from './data.js';
import { loadState, type ReviewRecord, type State } from '../state.js';
import { tailLog, parseLog, type LogEntry } from '../daemon/log.js';
import { checkGhAuth } from '../forge/github.js';
import { getAgent, type AgentAuth } from '../agents/index.js';
import type { Config } from '../config.js';

const REFRESH_MS = 2000;
const TAIL_LINES = 200;

export interface DaemonData {
  state: State | null;
  entries: LogEntry[];
  error: string | null;
  ghOk: boolean | null;
  agentAuth: AgentAuth | null;
}

/** Live state + log, polled every 2s; auth probes run once. */
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

  return { state, entries, error, ghOk, agentAuth };
}

export interface ViewState {
  hidden: Record<number, boolean>;
  windowIdx: number;
  sort: SortKey;
  filter: string;
  filtering: boolean;
  selected: number;
  logExpanded: boolean;
}

/** The rows the reviews box lists, in display order. App uses it to clamp the cursor and open PRs. */
export function visibleReviews(data: DaemonData, view: ViewState): ReviewRecord[] {
  return sortReviews(filterReviews(data.state?.history ?? [], view.filter), view.sort);
}

export function isRunning(state: State | null, config: Config, now: Date): boolean {
  const t = state?.lastTickAt;
  return !!t && now.getTime() - Date.parse(t) < config.pollIntervalMinutes * 60_000 + 30_000;
}

// ── layout ───────────────────────────────────────────────────────────────────
export function Dashboard({
  config, data, view, width, height, now,
}: {
  config: Config;
  data: DaemonData;
  view: ViewState;
  width: number;
  height: number;
  now: Date;
}) {
  const wide = width >= 90;
  const show = (n: number) => !view.hidden[n];

  const activityH = show(1) ? Math.max(7, Math.min(12, Math.round(height * 0.3))) : 0;
  const midH = show(2) || show(3) ? Math.max(8, Math.min(12, config.repos.length + 4)) : 0;
  const midTotal = !wide && show(2) && show(3) ? midH * 2 : midH;
  const logWanted = show(5) ? (view.logExpanded ? 14 : 7) : 0;
  const rest = height - activityH - midTotal - logWanted;
  const reviewsH = show(4) ? Math.max(5, rest) : 0;
  // Reviews hidden: the log takes its space.
  const logH = show(4) ? logWanted : show(5) ? Math.max(logWanted, rest + logWanted) : 0;

  const sysW = wide && show(3) ? Math.min(40, Math.floor(width * 0.36)) : width;
  const reposW = wide && show(2) ? width - sysW : width;

  return (
    <Box flexDirection="column" width={width}>
      {show(1) && <ActivityBox config={config} data={data} view={view} width={width} height={activityH} now={now} />}
      {(show(2) || show(3)) && (
        <Box flexDirection={wide ? 'row' : 'column'}>
          {show(2) && <SystemBox config={config} data={data} width={sysW} height={midH} now={now} />}
          {show(3) && <ReposBox config={config} data={data} width={reposW} height={midH} now={now} />}
        </Box>
      )}
      {show(4) && <ReviewsBox data={data} view={view} width={width} height={reviewsH} now={now} />}
      {show(5) && logH > 0 && <LogBox data={data} width={width} height={logH} expanded={view.logExpanded} />}
    </Box>
  );
}

// ── ¹ activity ───────────────────────────────────────────────────────────────
function ActivityBox({ config, data, view, width, height, now }: {
  config: Config; data: DaemonData; view: ViewState; width: number; height: number; now: Date;
}) {
  const color = theme.box.activity;
  const win = WINDOWS[view.windowIdx];
  const history = data.state?.history ?? [];
  const inner = width - 2;
  const sideW = inner >= 76 ? 30 : 0;
  const gw = Math.max(4, inner - sideW - (sideW ? 2 : 0));
  const graphRows = Math.max(2, height - 3);
  const up = Math.ceil(graphRows / 2);
  const down = graphRows - up;
  const firsts = histogram(history, now, win.ms, win.buckets, (r) => (r.kind === 'review' && r.outcome === 'posted' && !r.rereview ? 1 : 0));
  const pushes = histogram(history, now, win.ms, win.buckets, (r) => (r.kind === 'review' && r.outcome === 'posted' && r.rereview ? 1 : 0));
  const t = tally(inWindow(history, now, win.ms));
  const total = t.reviews + t.rereviews;
  const running = isRunning(data.state, config, now);

  const right: Seg[] = [
    { text: now.toTimeString().slice(0, 8), color: theme.title, bold: true },
    { text: '─', color },
    { text: 'w', color: theme.hotkey, bold: true },
    { text: ` ${win.label}`, color: theme.title },
  ];

  return (
    <BBox title="activity" hotkey={1} width={width} height={height} color={color} right={right}
      footer={hint('w', 'window', color)}>
      <Box flexDirection="row">
        <Box flexDirection="column" width={gw}>
          <Text wrap="truncate">
            <Text color={theme.cool[2]}>▲ new PRs </Text>
            <Text color={theme.title} bold>{t.reviews}</Text>
            <Text color={theme.dim}>   ▼ re-reviews </Text>
            <Text color={theme.magenta[2]} bold>{t.rereviews}</Text>
            <Text color={theme.dim}> · last {win.label}</Text>
            {!running && <Text color={theme.bad}>  ● daemon not running</Text>}
          </Text>
          <Graph values={resample(firsts, gw * 2)} width={gw} height={up} stops={theme.cool} />
          {down > 0 && <Graph values={resample(pushes, gw * 2)} width={gw} height={down} stops={theme.magenta} down />}
        </Box>
        {sideW > 0 && (
          <Box flexDirection="column" width={sideW} marginLeft={2}>
            <CountLine label="reviews" n={t.reviews} total={total} color={theme.cool[2]} />
            <CountLine label="re-rev" n={t.rereviews} total={total} color={theme.magenta[2]} />
            <CountLine label="fixed" n={t.resolved} total={Math.max(total, t.resolved)} color={theme.ok} />
            <CountLine label="failed" n={t.failed} total={Math.max(total, t.failed)} color={theme.bad} />
            <Text> </Text>
            <Text wrap="truncate">
              <Text color={theme.dim}>avg review </Text>
              <Text color={theme.title} bold>{t.avgMs > 0 ? duration(t.avgMs) : '—'}</Text>
            </Text>
          </Box>
        )}
      </Box>
    </BBox>
  );
}

function CountLine({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  return (
    <Text wrap="truncate">
      <Text color={color}>{label.padEnd(8)}</Text>
      <Segs segs={meterSegs(n, Math.max(1, total), 16, [color, color])} />
      <Text color={n > 0 ? theme.title : theme.dim}> {String(n).padStart(4)}</Text>
    </Text>
  );
}

// ── ² system ─────────────────────────────────────────────────────────────────
function SystemBox({ config, data, width, height, now }: {
  config: Config; data: DaemonData; width: number; height: number; now: Date;
}) {
  const color = theme.box.system;
  const lastTick = data.state?.lastTickAt ?? null;
  const running = isRunning(data.state, config, now);
  const inner = width - 2;
  const row = (segs: Seg[]) => (
    <Text wrap="truncate">
      <Segs segs={fitSegs(segs, inner)} />
    </Text>
  );
  const label = (s: string): Seg => ({ text: ' ' + s.padEnd(8), color: theme.dim });

  const daemon: Seg[] = lastTick === null
    ? [dot(false), label('daemon'), { text: 'never ran · prw daemon', color: theme.text }]
    : [dot(running), label('daemon'), { text: running ? `up · tick ${ago(lastTick, now)} ago` : `stopped ${ago(lastTick, now)} ago`, color: theme.text }];
  const gh: Seg[] = [dot(data.ghOk), label('gh'),
    { text: data.ghOk === null ? 'checking…' : data.ghOk ? 'logged in' : 'NOT LOGGED IN', color: theme.text }];
  const a = data.agentAuth;
  const agentText = a === null ? 'checking…' : a === 'ok' ? 'auth OK' : a === 'unknown' ? 'installed' : a === 'missing' ? 'NOT FOUND' : 'NOT LOGGED IN';
  const agentRow: Seg[] = [dot(a === null || a === 'unknown' ? null : a === 'ok'), label(config.agent), { text: agentText, color: theme.text }];
  const fix = data.ghOk === false ? 'gh auth login'
    : a === 'not-authed' ? getAgent(config.agent).loginHint
      : a === 'missing' ? `install ${config.agent}` : undefined;

  const flag = (on: boolean, name: string): Seg => ({ text: `${on ? '◆' : '◇'} ${name} `, color: on ? theme.ok : theme.dim });

  return (
    <BBox title="system" hotkey={2} width={width} height={height} color={color}
      right={[{ text: config.profile, color: theme.title }]}
      footer={[...hint('a', 'agent', color), ...hint('c', 'conflicts', color)]}>
      {row(daemon)}
      {row(gh)}
      {row(agentRow)}
      {fix !== undefined && row([{ text: `  → ${fix}`, color: theme.warn }])}
      {row([flag(config.autoResolveConflicts, 'auto-fix'), flag(config.chat, 'chat'), flag(config.lineComments, 'inline'), flag(config.reReviewOnPush, 'push')])}
      {row([{ text: `poll ${config.pollIntervalMinutes}m · timeout ${config.agentTimeoutMinutes}m`, color: theme.dim }])}
      {data.error !== null && row([{ text: `⚠ ${data.error}`, color: theme.bad }])}
    </BBox>
  );
}

// ── ³ repos ──────────────────────────────────────────────────────────────────
const BADGE: Record<string, Seg> = {
  posted: { text: ' REVIEW ', bg: '#1d4ed8', color: '#ffffff', bold: true },
  rereview: { text: ' RE-REV ', bg: '#86198f', color: '#ffffff', bold: true },
  resolved: { text: ' FIXED  ', bg: '#15803d', color: '#ffffff', bold: true },
  failed: { text: ' FAIL   ', color: theme.bad, bold: true },
  skipped: { text: ' SKIP   ', color: theme.dim },
};
export const badgeFor = (r: ReviewRecord): Seg =>
  r.outcome === 'posted' && r.rereview ? BADGE.rereview : BADGE[r.outcome];

function ReposBox({ config, data, width, height, now }: {
  config: Config; data: DaemonData; width: number; height: number; now: Date;
}) {
  const color = theme.box.repos;
  const inner = width - 2;
  const last = lastByRepo(data.state?.history ?? []);
  const nameW = Math.max(8, Math.min(30, inner - 37, Math.max(4, ...config.repos.map((r) => r.length))));
  const counts = config.repos.map((r) => data.state?.repos[r]?.reviewed.length ?? 0);
  const peak = Math.max(1, ...counts);
  const meterW = Math.max(0, inner - nameW - 37);
  const rows = height - 3;

  return (
    <BBox title="repos" hotkey={3} width={width} height={height} color={color}
      right={[{ text: `${config.repos.length} watched`, color: theme.title }]}
      footer={hint('r', 'manage', color)}>
      {config.repos.length === 0 ? (
        <Text color={theme.dim}>nothing watched · press r to add a repo</Text>
      ) : (
        <>
          <Text color={theme.dim} wrap="truncate">
            {cell('repo', nameW)} {cell('revd', 5, 'right')} {cell('fail', 5, 'right')} {cell('retry', 6, 'right')}  {cell('last', 8)} {cell('', 5)}
          </Text>
          {config.repos.slice(0, rows).map((repo, i) => {
            const rs = data.state?.repos[repo];
            const failed = rs?.failed.length ?? 0;
            const queued = rs ? Object.keys(rs.retries).length : 0;
            const active = data.state?.active?.repo === repo;
            const l = last[repo];
            return (
              <Text key={repo} wrap="truncate">
                <Text color={theme.text}>{cell(repo, nameW)}</Text>{' '}
                <Text color={theme.ok}>{cell(String(counts[i]), 5, 'right')}</Text>{' '}
                <Text color={failed > 0 ? theme.bad : theme.dim}>{cell(String(failed), 5, 'right')}</Text>{' '}
                <Text color={queued > 0 ? theme.warn : theme.dim}>{cell(String(queued), 6, 'right')}</Text>{'  '}
                {l ? <Segs segs={[badgeFor(l)]} /> : <Text color={theme.dim}>{cell('   ·', 8)}</Text>}{' '}
                <Text color={active ? theme.warn : theme.dim}>{active ? cell('now', 6) : l ? cell(ago(l.at, now), 6) : cell('', 6)}</Text>
                {meterW > 0 && <Segs segs={meterSegs(counts[i], peak, meterW, theme.cool.slice(1))} />}
              </Text>
            );
          })}
        </>
      )}
    </BBox>
  );
}

// ── ⁴ reviews ────────────────────────────────────────────────────────────────
function ReviewsBox({ data, view, width, height, now }: {
  data: DaemonData; view: ViewState; width: number; height: number; now: Date;
}) {
  const color = theme.box.reviews;
  const inner = width - 2;
  const list = visibleReviews(data, view);
  const active = data.state?.active ?? null;
  const rows = Math.max(0, height - 3 - (active ? 1 : 0));
  const sel = Math.min(view.selected, Math.max(0, list.length - 1));
  const top = Math.max(0, sel - rows + 1);
  const shown = list.slice(top, top + rows);

  const repoW = Math.min(32, Math.max(14, Math.floor(inner * 0.26)));
  const authorW = inner >= 100 ? 14 : 0;
  const fixed = 6 + repoW + 1 + 8 + 1 + 7 + (authorW ? authorW + 1 : 0);
  const titleW = Math.max(0, inner - fixed);

  const right: Seg[] = [
    ...(view.filtering || view.filter
      ? [{ text: 'filter ', color: theme.dim }, { text: view.filter + (view.filtering ? '█' : ''), color: theme.title, bold: true }, { text: '─', color }]
      : []),
    { text: 's', color: theme.hotkey, bold: true },
    { text: ` ${view.sort} ▾`, color: theme.title },
    { text: '─', color },
    { text: list.length === 0 ? '0/0' : `${sel + 1}/${list.length}`, color: theme.title },
  ];

  return (
    <BBox title="reviews" hotkey={4} width={width} height={height} color={color} right={right}
      footer={[...hint('↑↓', 'select', color), ...hint('⏎', 'open PR', color), ...hint('f', 'filter', color), ...hint('s', 'sort', color)]}>
      <Text color={theme.dim} wrap="truncate">
        {cell('when', 5)} {cell('pr', repoW)} {cell('result', 8)} {cell('took', 6, 'right')}{' '}
        {authorW > 0 && `${cell('author', authorW)} `}
        {cell('title', titleW)}
      </Text>
      {active && (
        <Text wrap="truncate">
          <Spinner color={theme.warn} />
          <Text color={theme.warn}>{cell(' now', 5)}</Text>
          <Text color={theme.title} bold>{cell(`${active.repo}#${active.pr}`, repoW)} </Text>
          <Text color={theme.bg} backgroundColor={theme.warn} bold>
            {active.kind === 'conflict' ? ' MERGING' : active.rereview ? ' RE-REV ' : ' REVIEW '}
          </Text>
          <Text color={theme.dim}> {cell(duration(now.getTime() - Date.parse(active.startedAt)), 6, 'right')} </Text>
          {authorW > 0 && <Text>{cell('', authorW)} </Text>}
          <Text color={theme.text}>{cell(active.title, titleW)}</Text>
        </Text>
      )}
      {list.length === 0 && !active && (
        <Text color={theme.dim}>
          {view.filter ? `no reviews match “${view.filter}”` : 'no reviews yet · new PRs on watched repos show up here'}
        </Text>
      )}
      {shown.map((r, i) => {
        const selected = top + i === sel;
        const bg = selected ? theme.selBg : undefined;
        const fg = (c: string) => (selected ? theme.selFg : c);
        const segs: Seg[] = [
          { text: cell(ago(r.at, now), 5) + ' ', color: fg(theme.dim), bg },
          { text: cell(`${r.repo}#${r.pr}`, repoW) + ' ', color: fg(theme.title), bg, bold: selected },
          badgeFor(r),
          { text: ' ', bg },
          { text: cell(duration(r.durationMs), 6, 'right') + ' ', color: fg(theme.dim), bg },
          ...(authorW > 0 ? [{ text: cell((r.fromFork ? '⑂ ' : '') + r.author, authorW) + ' ', color: fg(r.fromFork ? theme.warn : theme.text), bg }] : []),
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

// ── ⁵ log ────────────────────────────────────────────────────────────────────
function LogBox({ data, width, height, expanded }: { data: DaemonData; width: number; height: number; expanded: boolean }) {
  const color = theme.box.log;
  const recent = data.entries.slice(-Math.max(0, height - 2));
  const tone = (t: string) =>
    t.startsWith('FAILED') || t.includes('error') || t.startsWith('could not') ? theme.bad
      : t.startsWith('posted') || t.startsWith('resolved') ? theme.ok
        : t.startsWith('reviewing') ? theme.warn
          : theme.text;
  return (
    <BBox title="log" hotkey={5} width={width} height={height} color={color}
      footer={hint('l', expanded ? 'shrink' : 'expand', color)}>
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
