import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Menu } from './Menu.js';
import { Banner } from './Banner.js';
import { RepoPicker } from './RepoPicker.js';
import { Dashboard, useDaemonData, reviewsOf } from './Dashboard.js';
import { BBox, Keys, theme, useNow, useTerminalSize } from './btop.js';
import { prUrl } from './data.js';
import { openUrl } from './open.js';
import { saveConfig, type Config, type AgentName } from '../config.js';
import { detectInstalledAgents } from '../agents/index.js';

type Screen = 'dashboard' | 'repos' | 'repos-add' | 'agent' | 'service';

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
  const [selected, setSelected] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const { cols, rows } = useTerminalSize();
  const now = useNow(1000);
  const data = useDaemonData(config.agent);
  const width = Math.max(40, cols);
  const bodyHeight = Math.max(8, rows - 2);
  const list = reviewsOf(data);
  const empty = config.repos.length === 0 && list.length === 0;

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
    setMessage('');
    const max = Math.max(0, list.length - 1);
    if (key.upArrow || input === 'k') setSelected((s) => Math.max(0, Math.min(s, max) - 1));
    else if (key.downArrow || input === 'j') setSelected((s) => Math.min(max, s + 1));
    else if (key.return && !showLog) {
      const r = list[Math.min(selected, max)];
      if (r) {
        open(prUrl(r.repo, r.pr));
        setMessage(`opened ${r.repo}#${r.pr} in your browser`);
      }
    } else if (input === 'l') setShowLog((v) => !v);
    else if (input === 'r') setScreen('repos');
    else if (input === 'a') setScreen('agent');
    else if (input === 'c') {
      update({ autoResolveConflicts: !config.autoResolveConflicts });
      setMessage(`conflict auto-fix ${config.autoResolveConflicts ? 'off' : 'on'}`);
    }
    else if (input === 'i') setScreen('service');
    else if (input === 'q') exit();
  });

  const keys: Array<[string, string]> =
    screen !== 'dashboard' ? [['↑↓', 'move'], ['⏎', 'select'], ['esc', 'back']]
      : empty ? [['r', 'add a repo'], ['a', 'agent'], ['q', 'quit']]
        : [['↑↓', 'move'], ['⏎', 'open PR'], ['l', showLog ? 'reviews' : 'log'], ['r', 'repos'], ['a', 'agent'], ['c', 'auto-fix'], ['i', 'service'], ['q', 'quit']];

  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Box width={width} justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={theme.accent} bold> ◉ prwatch</Text>
          {message !== '' && <Text color={theme.warn}>   {message}</Text>}
        </Text>
        <Text color={theme.dim}>
          {config.repos.length} repo{config.repos.length === 1 ? '' : 's'} · {config.agent} · {config.profile}{' '}
        </Text>
      </Box>

      {screen === 'dashboard' && (empty ? (
        <BBox title="welcome" width={width} height={bodyHeight}>
          <Box flexDirection="column" alignItems="center" justifyContent="center" height={bodyHeight - 2}>
            <Banner width={width - 6} />
            <Text> </Text>
            <Text color={theme.text}>
              nothing watched yet · press <Text color={theme.key} bold>r</Text> to add a repo, then run{' '}
              <Text color={theme.title} bold>prw daemon</Text>
            </Text>
          </Box>
        </BBox>
      ) : (
        <Dashboard config={config} data={data} selected={selected} showLog={showLog} width={width} height={bodyHeight} now={now} />
      ))}

      {screen === 'repos' && (
        <BBox title="repos" width={width} height={bodyHeight}>
          <Text color={theme.dim}>⏎ on a repo stops watching it</Text>
          <Menu
            items={[...config.repos.map((r) => `remove ${r}`), 'add a repo']}
            onSelect={(item) => {
              if (item === 'add a repo') setScreen('repos-add');
              else update({ repos: config.repos.filter((r) => r !== item.replace('remove ', '')) });
            }}
          />
        </BBox>
      )}
      {screen === 'repos-add' && (
        <BBox title="add a repo" width={width} height={bodyHeight}>
          <RepoPicker
            existing={config.repos}
            onDone={(repo) => {
              if (repo && !config.repos.includes(repo)) update({ repos: [...config.repos, repo] });
              setScreen('repos');
            }}
          />
        </BBox>
      )}
      {screen === 'agent' && (
        <BBox title="agent" width={width} height={bodyHeight}>
          <AgentPicker onPick={(name) => { update({ agent: name }); setScreen('dashboard'); }} />
        </BBox>
      )}
      {screen === 'service' && (
        <BBox title="service" width={width} height={bodyHeight}>
          <ServiceInstaller onDone={(msg) => { setMessage(msg); setScreen('dashboard'); }} />
        </BBox>
      )}

      <Keys keys={keys} />
    </Box>
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
