import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logsDir } from './paths.js';
import { runCommand } from './run-command.js';

export function launchdPlist(nodeBin: string, scriptPath: string, logsDirPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.prwatch.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${scriptPath}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logsDirPath}/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${logsDirPath}/launchd.err.log</string>
</dict>
</plist>
`;
}

export function systemdUnit(nodeBin: string, scriptPath: string): string {
  return `[Unit]
Description=prwatch PR review daemon

[Service]
ExecStart=${nodeBin} ${scriptPath} daemon
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
`;
}

export async function installService(): Promise<string> {
  const nodeBin = process.execPath;
  const scriptPath = fileURLToPath(new URL('./index.js', import.meta.url));

  if (process.platform === 'darwin') {
    const dest = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.prwatch.daemon.plist');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, launchdPlist(nodeBin, scriptPath, logsDir()));
    await runCommand('launchctl', ['unload', dest], { timeoutMs: 10_000 }).catch(() => {});
    await runCommand('launchctl', ['load', '-w', dest], { timeoutMs: 10_000 });
    return dest;
  }

  const dest = path.join(os.homedir(), '.config', 'systemd', 'user', 'prwatch.service');
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, systemdUnit(nodeBin, scriptPath));
  await runCommand('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 10_000 });
  await runCommand('systemctl', ['--user', 'enable', '--now', 'prwatch'], { timeoutMs: 10_000 });
  return dest;
}
