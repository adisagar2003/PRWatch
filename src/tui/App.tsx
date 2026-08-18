import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Menu } from './Menu.js';
import { Banner } from './Banner.js';
import { RepoPicker } from './RepoPicker.js';
import { Dashboard } from './Dashboard.js';
import { Panel, useTerminalWidth } from './chrome.js';
import { ui, Footer } from './ui.js';
import { saveConfig, type Config, type AgentName } from '../config.js';
import { detectInstalledAgents } from '../agents/index.js';

type Screen = 'dashboard' | 'repos' | 'repos-add' | 'agent' | 'service';

const LOG_HEIGHT = 8;
const LOG_HEIGHT_EXPANDED = 20;

export function App({ initialConfig }: { initialConfig: Config }) {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const width = Math.max(40, useTerminalWidth() - 2);

  const update = (patch: Partial<Config>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next).catch((e) => setMessage(`could not save config: ${(e as Error).message}`));
  };

  useInput((input, key) => {
    if (key.escape && screen !== 'dashboard') {
      setScreen('dashboard');
      return;
    }
    if (screen !== 'dashboard') return; // sub-screens own their own keys
    setMessage('');
    if (input === '1') setScreen('service');
    else if (input === '2') setScreen('agent');
    else if (input === '3') setScreen('repos');
    else if (input === '4') setExpanded((e) => !e);
    else if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text>
        <Text color={ui.accent} bold>
          👁 prwatch
        </Text>
        <Text dimColor> · local PR reviewer · </Text>
        <Text color={ui.info}>{config.repos.length}</Text>
        <Text dimColor> repo{config.repos.length === 1 ? '' : 's'} · </Text>
        <Text color={ui.info}>{config.agent}</Text>
      </Text>
      {message !== '' && <Text color={ui.warn}>⚠ {message}</Text>}

      {screen === 'dashboard' &&
        (config.repos.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Banner />
            <Text dimColor>nothing watched yet — press 3 to add a repo</Text>
          </Box>
        ) : (
          <Dashboard
            config={config}
            width={width}
            logHeight={expanded ? LOG_HEIGHT_EXPANDED : LOG_HEIGHT}
          />
        ))}
      {screen === 'repos' && (
        <ReposScreen
          repos={config.repos}
          width={width}
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
          width={width}
          onPick={(name) => {
            update({ agent: name });
            setScreen('dashboard');
          }}
        />
      )}
      {screen === 'service' && (
        <ServiceScreen
          width={width}
          onDone={(msg) => {
            setMessage(msg);
            setScreen('dashboard');
          }}
        />
      )}

      {screen === 'dashboard' ? (
        <Footer
          hints={[
            ['1', 'service'],
            ['2', 'agent'],
            ['3', 'repos'],
            ['4', expanded ? 'shrink log' : 'expand log'],
            ['q', 'quit'],
          ]}
        />
      ) : (
        <Footer
          hints={[
            ['↑↓', 'navigate'],
            ['⏎', 'select'],
            ['esc', 'back'],
          ]}
        />
      )}
    </Box>
  );
}

function ReposScreen({
  repos,
  width,
  onAdd,
  onRemove,
}: {
  repos: string[];
  width: number;
  onAdd: () => void;
  onRemove: (repo: string) => void;
}) {
  const items = [...repos.map((r) => `remove ${r}`), 'add a repo'];
  return (
    <Panel title="repos" width={width}>
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

function AgentScreen({ width, onPick }: { width: number; onPick: (name: AgentName) => void }) {
  const [installed, setInstalled] = useState<AgentName[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detectInstalledAgents()
      .then((a) => setInstalled(a.map((x) => x.name)))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error !== null)
    return (
      <Panel title="agent" width={width} color={ui.error}>
        <Text color={ui.error}>⚠ agent detection failed: {error}</Text>
      </Panel>
    );
  if (installed === null)
    return (
      <Panel title="agent" width={width}>
        <Text dimColor>detecting installed agents…</Text>
      </Panel>
    );
  if (installed.length === 0)
    return (
      <Panel title="agent" width={width} color={ui.error}>
        <Text color={ui.error}>⚠ No agents found. Install claude, codex, or opencode first.</Text>
      </Panel>
    );
  return (
    <Panel title="agent" width={width}>
      <Menu items={installed} onSelect={(item) => onPick(item as AgentName)} />
    </Panel>
  );
}

function ServiceScreen({ width, onDone }: { width: number; onDone: (msg: string) => void }) {
  useEffect(() => {
    void import('../service.js')
      .then((m) => m.installService())
      .then((p) => onDone(`service installed: ${p}`))
      .catch((e) => onDone(`service install failed: ${(e as Error).message}`));
  }, []);
  return (
    <Panel title="service" width={width}>
      <Text dimColor>installing service…</Text>
    </Panel>
  );
}
