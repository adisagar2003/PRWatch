import { describe, it, expect } from 'vitest';
import { launchdPlist, systemdUnit } from './service.js';

describe('service unit generation', () => {
  it('launchd plist runs node <script> daemon and keeps it alive', () => {
    const plist = launchdPlist('/usr/local/bin/node', '/x/dist/index.js', '/home/logs');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/x/dist/index.js</string>');
    expect(plist).toContain('<string>daemon</string>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('com.prwatch.daemon');
    expect(plist).toContain('/home/logs/launchd.out.log');
  });

  it('systemd unit runs node <script> daemon with restart', () => {
    const unit = systemdUnit('/usr/bin/node', '/x/dist/index.js');
    expect(unit).toContain('ExecStart=/usr/bin/node /x/dist/index.js daemon');
    expect(unit).toContain('Restart=always');
  });
});
