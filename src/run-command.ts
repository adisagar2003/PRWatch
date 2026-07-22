import { spawn } from 'node:child_process';

const activeChildren = new Set<number>();

export function killActiveProcessGroups(): void {
  for (const pid of activeChildren) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  activeChildren.clear();
}

export function runCommand(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    if (child.pid !== undefined) {
      activeChildren.add(child.pid);
    }
    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error(`${bin} timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      if (child.pid !== undefined) activeChildren.delete(child.pid);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (child.pid !== undefined) activeChildren.delete(child.pid);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}
