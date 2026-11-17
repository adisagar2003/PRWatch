import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Menu } from './Menu.js';
import { Banner } from './Banner.js';
import { RepoPicker } from './RepoPicker.js';
import { Dashboard, useDaemonData, visibleReviews, isRunning, type ViewState } from './Dashboard.js';
import { BBox, Segs, hint, theme, useNow, useTerminalSize, type Seg } from './btop.js';
import { SORTS, WINDOWS, prUrl } from './data.js';
import { openUrl } from './open.js';
import { saveConfig, type Config, type AgentName } from '../config.js';
import { detectInstalledAgents } from '../agents/index.js';

type Screen = 'dashboard' | 'repos' | 'repos-add' | 'agent' | 'service';

const INITIAL_VIEW: ViewState = {
  hidden: {},
  windowIdx: 2,
  sort: 'time',
  filter: '',
  filtering: false,
  selected: 0,
  logExpanded: false,
};

export function App({
  initialConfig,
  open = openUrl,
}: {
  initialConfig: Config;
  /** Injected in tests so ⏎ doesn't launch a browser. */
  open?: (url: string) => void;
}) {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const { cols, rows } = useTerminalSize();
  const now = useNow(1000);
  const data = useDaemonData(config.agent);
  const width = Math.max(40, cols);
  const bodyHeight = Math.max(10, rows - 1);

  const list = visibleReviews(data, view);
  const patch = (p: Partial<ViewState>) => setView((v) => ({ ...v, ...p }));

  // Keep the cursor on a real row as the list grows, shrinks or gets filtered.
  useEffect(() => {
    if (view.selected > 0 && view.selected >= list.length) patch({ selected: Math.max(0, list.length - 1) });
  }, [list.length]);

  const update = (p: Partial<Config>) => {
    const next = { ...config, ...p };
    setConfig(next);
    saveConfig(next).catch((e) => setMessage(`could not save config: ${(e as Error).message}`));
  };

  useInput((input, key) => {
    if (screen !== 'dashboard') {
      if (key.escape) setScreen('dashboard');
      return; // sub-screens own their keys
    }
    if (view.filtering) {
      if (key.escape) patch({ filtering: false, filter: '', selected: 0 });
      else if (key.return) patch({ filtering: false });
      else if (key.backspace || key.delete) patch({ filter: view.filter.slice(0, -1), selected: 0 });
      else if (input && !key.ctrl && !key.meta) patch({ filter: view.filter + input, selected: 0 });
      return;
    }
    setMessage('');
    const max = Math.max(0, list.length - 1);
    if (key.upArrow || input === 'k') patch({ selected: Math.max(0, view.selected - 1) });
    else if (key.downArrow || input === 'j') patch({ selected: Math.min(max, view.selected + 1) });
    else if (key.pageUp) patch({ selected: Math.max(0, view.selected - 10) });
    else if (key.pageDown) patch({ selected: Math.min(max, view.selected + 10) });
    else if (key.return) {
      const r = list[Math.min(view.selected, max)];
      if (r) {
        open(prUrl(r.repo, r.pr));
        setMessage(`opened ${r.repo}#${r.pr}`);
      }
    } else if (key.escape && view.filter) patch({ filter: '', selected: 0 });
    else if (/^[1-5]$/.test(input)) {
      const n = Number(input);
      patch({ hidden: { ...view.hidden, [n]: !view.hidden[n] } });
    } else if (input === 'f' || input === '/') patch({ filtering: true });
    else if (input === 's') patch({ sort: SORTS[(SORTS.indexOf(view.sort) + 1) % SORTS.length], selected: 0 });
    else if (input === 'w') patch({ windowIdx: (view.windowIdx + 1) % WINDOWS.length });
    else if (input === 'l') patch({ logExpanded: !view.logExpanded });
    else if (input === 'r') setScreen('repos');
    else if (input === 'a') setScreen('agent');
    else if (input === 'c') {
      update({ autoResolveConflicts: !config.autoResolveConflicts });
      setMessage(`auto-fix conflicts ${config.autoResolveConflicts ? 'off' : 'on'}`);
    }
    else if (input === 'i') setScreen('service');
    else if (input === 'q') exit();
  });

  const running = isRunning(data.state, config, now);
  const topBar: Seg[] = [
    { text: ' ◉ ', color: '#22d3ee', bold: true },
    { text: 'prwatch', color: theme.title, bold: true },
    { text: '  ', color: theme.dim },
    { text: running ? '● watching' : '○ idle', color: running ? theme.ok : theme.dim },
    { text: `  ${config.repos.length} repo${config.repos.length === 1 ? '' : 's'} · ${config.agent}`, color: theme.dim },
  ];
  const keys: Array<[string, string]> = [['r', 'repos'], ['a', 'agent'], ['i', 'service'], ['q', 'quit']];

  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Box width={width} justifyContent="space-between">
        <Text wrap="truncate">
          <Segs segs={topBar} />
          {message !== '' && <Text color={theme.warn}>  {message}</Text>}
        </Text>
        <Text>
          {keys.map(([k, l]) => (
            <Text key={k}>
              <Text color={theme.hotkey} bold>{k}</Text>
              <Text color={theme.dim}> {l}  </Text>
            </Text>
          ))}
        </Text>
      </Box>

      {screen === 'dashboard' &&
        (config.repos.length === 0 && (data.state?.history ?? []).length === 0 ? (
          <BBox title="welcome" width={width} height={bodyHeight} color={theme.box.activity}
            footer={[...hint('r', 'add a repo', theme.box.activity), ...hint('a', 'pick agent', theme.box.activity)]}>
            <Box flexDirection="column" alignItems="center" justifyContent="center" height={bodyHeight - 2}>
              <Banner width={width - 6} />
              <Text> </Text>
              <Text color={theme.text}>
                nothing watched yet · press <Text color={theme.hotkey} bold>r</Text> to add a repo, then run{' '}
                <Text color={theme.title} bold>prw daemon</Text>
              </Text>
            </Box>
          </BBox>
        ) : (
          <Dashboard config={config} data={data} view={view} width={width} height={bodyHeight} now={now} />
        ))}

      {screen === 'repos' && (
        <ScreenBox title="repos" width={width} height={bodyHeight}>
          <Text color={theme.dim}>⏎ to remove a repo, or add a new one</Text>
          <Menu
            items={[...config.repos.map((r) => `remove ${r}`), 'add a repo']}
            onSelect={(item) => {
              if (item === 'add a repo') setScreen('repos-add');
              else update({ repos: config.repos.filter((r) => r !== item.replace('remove ', '')) });
            }}
          />
        </ScreenBox>
      )}
      {screen === 'repos-add' && (
        <ScreenBox title="add repo" width={width} height={bodyHeight}>
          <RepoPicker
            existing={config.repos}
            onDone={(repo) => {
              if (repo && !config.repos.includes(repo)) update({ repos: [...config.repos, repo] });
              setScreen('repos');
            }}
          />
        </ScreenBox>
      )}
      {screen === 'agent' && (
        <ScreenBox title="agent" width={width} height={bodyHeight}>
          <AgentPicker onPick={(name) => { update({ agent: name }); setScreen('dashboard'); }} />
        </ScreenBox>
      )}
      {screen === 'service' && (
        <ScreenBox title="service" width={width} height={bodyHeight}>
          <ServiceInstaller onDone={(msg) => { setMessage(msg); setScreen('dashboard'); }} />
        </ScreenBox>
      )}
    </Box>
  );
}

function ScreenBox({ title, width, height, children }: { title: string; width: number; height: number; children: React.ReactNode }) {
  const color = theme.box.reviews;
  return (
    <BBox title={title} width={width} height={height} color={color}
      footer={[...hint('↑↓', 'navigate', color), ...hint('⏎', 'select', color), ...hint('esc', 'back', color)]}>
      <Box flexDirection="column" paddingX={1}>{children}</Box>
    </BBox>
  );
}

function AgentPicker({ onPick }: { onPick: (name: AgentName) => void }) {
  const [installed, setInstalled] = useState<AgentName[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    detectInstalledAgents()
      .then((a) => setInstalled(a.map((x) => x.name)))
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error !== null) return <Text color={theme.bad}>⚠ agent detection failed: {error}</Text>;
  if (installed === null) return <Text color={theme.dim}>detecting installed agents…</Text>;
  if (installed.length === 0) return <Text color={theme.bad}>⚠ No agents found. Install claude, codex, or opencode first.</Text>;
  return <Menu items={installed} onSelect={(item) => onPick(item as AgentName)} />;
}

function ServiceInstaller({ onDone }: { onDone: (msg: string) => void }) {
  useEffect(() => {
    void import('../service.js')
      .then((m) => m.installService())
      .then((p) => onDone(`service installed: ${p}`))
      .catch((e) => onDone(`service install failed: ${(e as Error).message}`));
  }, []);
  return <Text color={theme.dim}>installing service…</Text>;
}
