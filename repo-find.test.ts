import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'repo-find.sh');

let work: string;
let stubBin: string;
let cacheHome: string;
let ghCalls: string;

// Fake `gh` and `fzf` on PATH so the script runs fully offline and
// non-interactively. `gh repo list` emits two TSV rows and records each call;
// `fzf` echoes the first row (a "selection") or exits 130 to simulate cancel.
function writeStubs() {
  ghCalls = path.join(work, 'gh-calls');
  const gh = `#!/usr/bin/env bash
if [[ "$1" == "repo" && "$2" == "list" ]]; then
  echo x >> "${ghCalls}"
  printf 'owner/repo1\\tfirst repo\\n'
  printf 'owner/repo2\\tsecond repo\\n'
  exit 0
fi
echo "gh $*"
`;
  const fzf = `#!/usr/bin/env bash
if [[ "\${FZF_MODE:-select}" == "cancel" ]]; then exit 130; fi
head -n1
`;
  fs.writeFileSync(path.join(stubBin, 'gh'), gh, { mode: 0o755 });
  fs.writeFileSync(path.join(stubBin, 'fzf'), fzf, { mode: 0o755 });
}

function run(action: string, mode: 'select' | 'cancel' = 'select') {
  return spawnSync('bash', [SCRIPT, action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH}`,
      XDG_CACHE_HOME: cacheHome,
      FZF_MODE: mode,
    },
  });
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'repofind-'));
  stubBin = path.join(work, 'bin');
  cacheHome = path.join(work, 'cache');
  fs.mkdirSync(stubBin);
  writeStubs();
});

afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

describe('repo-find.sh', () => {
  it('prints the selected repo URL (default action)', () => {
    const r = run('url');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('https://github.com/owner/repo1');
  });

  it('routes the chosen repo into the requested action', () => {
    const r = run('clone');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gh repo clone owner/repo1');
  });

  it('caches the repo list — a second run does not call `gh repo list` again', () => {
    run('url');
    run('url');
    const calls = fs.readFileSync(ghCalls, 'utf8').trim().split('\n').length;
    expect(calls).toBe(1);
    expect(fs.existsSync(path.join(cacheHome, 'prwatch', 'gh-repo-list.tsv'))).toBe(true);
  });

  it('exits cleanly when the picker is cancelled (fzf status 130)', () => {
    const r = run('url', 'cancel');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Nothing selected.');
    expect(r.stdout).not.toContain('https://github.com/');
  });
});
