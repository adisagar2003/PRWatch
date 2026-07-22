import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Menu } from './Menu.js';
import { Banner } from './Banner.js';
import { saveConfig, type Config, type AgentName } from '../config.js';
import { loadState, type CurrentJob } from '../state.js';
import { detectInstalledAgents, getAgent } from '../agents/index.js';
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
      <Text bold color="magenta">
        prwatch — local PR reviewer ({config.repos.length} repo{config.repos.length === 1 ? '' : 's'} watched, agent: {config.agent})
      </Text>
      {message !== '' && <Text color="yellow">{message}</Text>}
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
      {screen === 'status' && <StatusScreen agentName={config.agent} />}
      {screen === 'repos' && (
        <ReposScreen
          repos={config.repos}
          onAdd={() => setScreen('repos-add')}
          onRemove={(repo) => update({ repos: config.repos.filter((r) => r !== repo) })}
        />
      )}
      {screen === 'repos-add' && (
        <AddRepoScreen
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
      {screen !== 'menu' && <Text dimColor>esc: back to menu</Text>}
    </Box>
  );
}

function StatusScreen({ agentName }: { agentName: AgentName }) {
  const [ghOk, setGhOk] = useState<boolean | null>(null);
  const [agentInstalled, setAgentInstalled] = useState<boolean | null>(null);
  const [currentJob, setCurrentJob] = useState<CurrentJob | null>(null);
  const [lastTick, setLastTick] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkGhAuth()
      .then(setGhOk)
      .catch((e) => setError((e as Error).message));
    getAgent(agentName)
      .isInstalled()
      .then(setAgentInstalled)
      .catch((e) => setError((e as Error).message));
    loadState()
      .then((s) => {
        setLastTick(s.lastTickAt);
        setCurrentJob(s.currentJob ?? null);
      })
      .catch((e) => setError((e as Error).message));
    tailLog(10)
      .then(setLogLines)
      .catch((e) => setError((e as Error).message));
  }, [agentName]);

  const agentStatus =
    agentInstalled === null
      ? '…'
      : !agentInstalled
        ? `NOT FOUND — install ${agentName}`
        : currentJob
          ? `installed · reviewing ${currentJob.repo}#${currentJob.pr} since ${currentJob.startedAt}`
          : 'installed · idle';

  return (
    <Box flexDirection="column">
      {error !== null && <Text color="red">{error}</Text>}
      <Text>gh auth: {ghOk === null ? '…' : ghOk ? 'OK' : 'NOT LOGGED IN — run `gh auth login`'}</Text>
      <Text>
        agent ({agentName}): {agentStatus}
      </Text>
      <Text>last daemon tick: {lastTick ?? 'never (is `prw daemon` running?)'}</Text>
      <Text bold>recent log:</Text>
      {logLines.length === 0 && <Text dimColor>(empty)</Text>}
      {logLines.map((l, i) => (
        <Text key={i} dimColor>
          {l}
        </Text>
      ))}
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
    <Box flexDirection="column">
      <Text bold>Watched repos (enter to remove):</Text>
      <Menu
        items={items}
        onSelect={(item) => {
          if (item === 'add a repo') onAdd();
          else onRemove(item.replace('remove ', ''));
        }}
      />
    </Box>
  );
}

function AddRepoScreen({ onDone }: { onDone: (repo: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Box>
      <Text>owner/name: </Text>
      <TextInput value={value} onChange={setValue} onSubmit={(v) => onDone(v.trim())} />
    </Box>
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

  if (error !== null) return <Text color="red">agent detection failed: {error}</Text>;
  if (installed === null) return <Text>detecting installed agents…</Text>;
  if (installed.length === 0)
    return <Text color="red">No agents found. Install claude, codex, or opencode first.</Text>;
  return (
    <Box flexDirection="column">
      <Text bold>Pick review agent:</Text>
      <Menu items={installed} onSelect={(item) => onPick(item as AgentName)} />
    </Box>
  );
}

function ServiceScreen({ onDone }: { onDone: (msg: string) => void }) {
  useEffect(() => {
    void import('../service.js')
      .then((m) => m.installService())
      .then((p) => onDone(`service installed: ${p}`))
      .catch((e) => onDone(`service install failed: ${(e as Error).message}`));
  }, []);
  return <Text>installing service…</Text>;
}
