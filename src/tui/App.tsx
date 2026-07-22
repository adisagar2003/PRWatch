import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Menu } from './Menu.js';
import { Banner } from './Banner.js';
import { RepoPicker } from './RepoPicker.js';
import { ui, Panel, Footer, StatusDot } from './ui.js';
import { saveConfig, type Config, type AgentName } from '../config.js';
import { loadState, type State } from '../state.js';
import { detectInstalledAgents } from '../agents/index.js';
import { checkGhAuth } from '../forge/github.js';
import { tailLog } from '../daemon/log.js';

type Screen = 'menu' | 'status' | 'repos' | 'repos-add' | 'agent' | 'service';

const MENU_ITEMS = ['Status', 'Repos', 'Agent', 'Install service', 'Quit'];

export function App({ initialConfig }: { initialConfig: Config }) {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [screen, setScreen] = useState<Screen>('menu');
  const [message, setMessage] = useState('');

  const update = (patch: Partial<Config>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next).catch((e) => setMessage(`could not save config: ${(e as Error).message}`));
  };

  useInput((_input, key) => {
    if (key.escape && screen !== 'menu') setScreen('menu');
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Banner />
      <Box marginTop={1}>
        <Text>
          <Text bold color={ui.accent}>
            prwatch
          </Text>
          <Text dimColor> · local PR reviewer</Text>
        </Text>
      </Box>
      <Text dimColor>
        {config.repos.length} repo{config.repos.length === 1 ? '' : 's'} watched · agent:{' '}
        <Text color={ui.info}>{config.agent}</Text>
      </Text>
      {message !== '' && (
        <Box marginTop={1}>
          <Text color={ui.warn}>⚠ {message}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
      {screen === 'menu' && (
        <Menu
          items={MENU_ITEMS}
          onSelect={(item) => {
            setMessage('');
            if (item === 'Quit') exit();
            else if (item === 'Status') setScreen('status');
            else if (item === 'Repos') setScreen('repos');
            else if (item === 'Agent') setScreen('agent');
            else if (item === 'Install service') setScreen('service');
          }}
        />
      )}
      {screen === 'status' && <StatusScreen config={config} />}
      {screen === 'repos' && (
        <ReposScreen
          repos={config.repos}
          onAdd={() => setScreen('repos-add')}
          onRemove={(repo) => update({ repos: config.repos.filter((r) => r !== repo) })}
        />
      )}
      {screen === 'repos-add' && (
        <RepoPicker
          existing={config.repos}
          onDone={(repo) => {
            if (repo && !config.repos.includes(repo)) update({ repos: [...config.repos, repo] });
            setScreen('repos');
          }}
        />
      )}
      {screen === 'agent' && (
        <AgentScreen
          onPick={(name) => {
            update({ agent: name });
            setScreen('menu');
          }}
        />
      )}
      {screen === 'service' && <ServiceScreen onDone={(msg) => { setMessage(msg); setScreen('menu'); }} />}
      </Box>
      {screen === 'menu' ? (
        <Footer hints={[['↑↓', 'navigate'], ['⏎', 'select']]} />
      ) : (
        <Footer hints={[['↑↓', 'navigate'], ['⏎', 'select'], ['esc', 'back']]} />
      )}
    </Box>
  );
}

const REFRESH_MS = 2000;

function agoLabel(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 90) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function StatusScreen({ config }: { config: Config }) {
  const [ghOk, setGhOk] = useState<boolean | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // gh auth is slow and rarely changes — check it once.
  useEffect(() => {
    checkGhAuth()
      .then(setGhOk)
      .catch((e) => setError((e as Error).message));
  }, []);

  // Poll state + log while the screen is open; clear the timer on unmount.
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
      tailLog(10)
        .then((l) => alive && setLogLines(l))
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const lastTick = state?.lastTickAt ?? null;
  // Consider the daemon "running" if it ticked within one poll interval + slack.
  const running =
    lastTick !== null && Date.now() - Date.parse(lastTick) < config.pollIntervalMinutes * 60_000 + 30_000;

  return (
    <Panel title="Status">
      {error !== null && <Text color={ui.error}>⚠ {error}</Text>}
      <Text>
        <StatusDot ok={running} /> daemon:{' '}
        {lastTick === null
          ? 'never ticked (is `prw daemon` running?)'
          : running
            ? `running (tick ${agoLabel(lastTick)})`
            : `idle/stopped (last tick ${agoLabel(lastTick)})`}
      </Text>
      <Text>
        <StatusDot ok={ghOk} /> gh auth:{' '}
        {ghOk === null ? 'checking…' : ghOk ? 'OK' : 'NOT LOGGED IN — run `gh auth login`'}
      </Text>

      <Box marginTop={1}>
        <Text bold color={ui.info}>
          repos
        </Text>
      </Box>
      <RepoTable config={config} state={state} />

      <Box marginTop={1}>
        <Text bold color={ui.info}>
          recent log <Text dimColor>· live</Text>
        </Text>
      </Box>
      {logLines.length === 0 && <Text dimColor>(empty)</Text>}
      {logLines.map((l, i) => (
        <Text key={i} dimColor>
          {l}
        </Text>
      ))}
    </Panel>
  );
}

function RepoTable({ config, state }: { config: Config; state: State | null }) {
  if (config.repos.length === 0) return <Text dimColor>(no repos watched)</Text>;
  const nameWidth = Math.min(40, Math.max(4, ...config.repos.map((r) => r.length)));
  const cell = (n: number) => String(n).padStart(5);
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {'repo'.padEnd(nameWidth)} {'revd'.padStart(5)} {'fail'.padStart(5)} {'retry'.padStart(5)}
      </Text>
      {config.repos.map((repo) => {
        const rs = state?.repos[repo];
        const pending = rs ? Object.keys(rs.retries).length : 0;
        return (
          <Text key={repo}>
            {repo.slice(0, nameWidth).padEnd(nameWidth)}{' '}
            <Text color={ui.success}>{cell(rs?.reviewed.length ?? 0)}</Text>{' '}
            <Text color={(rs?.failed.length ?? 0) > 0 ? ui.error : undefined}>
              {cell(rs?.failed.length ?? 0)}
            </Text>{' '}
            <Text color={pending > 0 ? ui.warn : undefined}>{cell(pending)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function ReposScreen({
  repos,
  onAdd,
  onRemove,
}: {
  repos: string[];
  onAdd: () => void;
  onRemove: (repo: string) => void;
}) {
  const items = [...repos.map((r) => `remove ${r}`), 'add a repo'];
  return (
    <Panel title="Watched repos">
      <Text dimColor>enter to remove a repo, or add a new one</Text>
      <Menu
        items={items}
        onSelect={(item) => {
          if (item === 'add a repo') onAdd();
          else onRemove(item.replace('remove ', ''));
        }}
      />
    </Panel>
  );
}

function AgentScreen({ onPick }: { onPick: (name: AgentName) => void }) {
  const [installed, setInstalled] = useState<AgentName[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detectInstalledAgents()
      .then((a) => setInstalled(a.map((x) => x.name)))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error !== null)
    return (
      <Panel title="Agent" borderColor={ui.error}>
        <Text color={ui.error}>⚠ agent detection failed: {error}</Text>
      </Panel>
    );
  if (installed === null)
    return (
      <Panel title="Agent">
        <Text dimColor>detecting installed agents…</Text>
      </Panel>
    );
  if (installed.length === 0)
    return (
      <Panel title="Agent" borderColor={ui.error}>
        <Text color={ui.error}>⚠ No agents found. Install claude, codex, or opencode first.</Text>
      </Panel>
    );
  return (
    <Panel title="Pick review agent">
      <Menu items={installed} onSelect={(item) => onPick(item as AgentName)} />
    </Panel>
  );
}

function ServiceScreen({ onDone }: { onDone: (msg: string) => void }) {
  useEffect(() => {
    void import('../service.js')
      .then((m) => m.installService())
      .then((p) => onDone(`service installed: ${p}`))
      .catch((e) => onDone(`service install failed: ${(e as Error).message}`));
  }, []);
  return (
    <Panel title="Install service">
      <Text dimColor>installing service…</Text>
    </Panel>
  );
}
