import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

import { readConfig, writeConfig } from '../config.js';
import { launchdPlistPath, systemdUnitPath } from './autostart/index.js';
import { runInstallAutostart } from './install-autostart.js';
import { formatUninstallAutostartReport, runUninstallAutostart } from './uninstall-autostart.js';

const execFileSyncMock = execFileSync as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_HOME = process.env.HOME;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
function resetPlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
}
function setHome(home: string): void {
  process.env.HOME = home;
  // biome-ignore lint/performance/noDelete: process.env requires `delete` to truly unset.
  delete process.env.XDG_CONFIG_HOME;
}
function resetHome(): void {
  if (ORIGINAL_HOME === undefined) {
    // biome-ignore lint/performance/noDelete: process.env requires `delete` to truly unset.
    delete process.env.HOME;
  } else process.env.HOME = ORIGINAL_HOME;
}

describe('uninstall-autostart', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-uninstall-autostart-'));
    setHome(root);
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((cmd: string, args: string[] = []) => {
      if (cmd === 'id' && args[0] === '-u') return Buffer.from('501\n');
      if (cmd === 'launchctl' && args[0] === 'list') return Buffer.from('');
      if (cmd === 'systemctl' && args[0] === '--user' && args[1] === 'show-environment') {
        return Buffer.from('PATH=/usr/bin\n');
      }
      if (cmd === 'systemctl' && args[0] === '--user' && args[1] === 'is-active') {
        return Buffer.from('inactive\n');
      }
      // reg query: by default the value is "not installed" (throw on
      // query, so isInstalled() returns false on the uninstall path).
      // Tests that need the inverse override mockImplementation per-call.
      if (cmd === 'reg' && args[0] === 'query') throw new Error('not installed');
      if (cmd === 'which' || cmd === 'where') return Buffer.from('/usr/bin/node\n');
      return Buffer.from('');
    });
  });
  afterEach(() => {
    resetPlatform();
    resetHome();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('dry-run is non-destructive: file remains, step.result is undefined', () => {
    setPlatform('darwin');
    runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(existsSync(launchdPlistPath())).toBe(true);

    const r = runUninstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(r.dryRun).toBe(true);
    expect(r.steps[0]?.result).toBeUndefined();
    expect(existsSync(launchdPlistPath())).toBe(true);
  });

  it('dry-run output mentions "would remove" / "would skip"', () => {
    setPlatform('darwin');
    runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    const r = runUninstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    const text = formatUninstallAutostartReport(r);
    expect(text).toMatch(/dry-run plan/);
    expect(text).toMatch(/would remove/);
  });

  it('yes=true removes the plist and flips config to autostart=false', () => {
    setPlatform('darwin');
    runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(existsSync(launchdPlistPath())).toBe(true);

    const r = runUninstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      yes: true,
    });
    expect(r.dryRun).toBe(false);
    expect(r.steps[0]?.result).toBe('removed');
    expect(existsSync(launchdPlistPath())).toBe(false);
    expect(readConfig(root).autostart).toBe(false);
  });

  it('yes=true on a non-installed platform reports skipped (no throw)', () => {
    setPlatform('darwin');
    const r = runUninstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      yes: true,
    });
    expect(r.steps[0]?.result).toBe('skipped');
  });

  it('Linux systemd: yes=true removes the unit file and runs disable', () => {
    setPlatform('linux');
    runInstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      backend: 'systemd',
    });
    expect(existsSync(systemdUnitPath())).toBe(true);

    const r = runUninstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      backend: 'systemd',
      yes: true,
    });
    expect(r.steps[0]?.result).toBe('removed');
    expect(existsSync(systemdUnitPath())).toBe(false);
    expect(readConfig(root).autostart).toBe(false);
  });

  it('preserves autostart=false in config after removal', () => {
    setPlatform('darwin');
    writeConfig({ autostart: true }, root);
    runUninstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m', yes: true });
    expect(readConfig(root).autostart).toBe(false);
  });
});
