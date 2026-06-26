import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OS-side exec calls so the tests don't actually touch launchd
// / systemd / schtasks during a CI run. Each test picks which calls
// should be made by setting the return value on the mock.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

import { readConfig } from '../config.js';
import {
  launchdPlistPath,
  scheduledTaskName,
  systemdUnitPath,
  xdgAutostartDesktopPath,
} from './autostart/index.js';
import { planUninstallAutostart, runInstallAutostart } from './install-autostart.js';

const execFileSyncMock = execFileSync as unknown as ReturnType<typeof vi.fn>;

// Capture the original platform so per-test overrides can be reverted.
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
  // Re-seed XDG_CONFIG_HOME so the autostart helpers pick up the new
  // root. Tests that care about $XDG_CONFIG_HOME override it directly.
  // biome-ignore lint/performance/noDelete: process.env requires `delete` to truly unset.
  delete process.env.XDG_CONFIG_HOME;
}

function resetHome(): void {
  if (ORIGINAL_HOME === undefined) {
    // biome-ignore lint/performance/noDelete: process.env requires `delete` to truly unset.
    delete process.env.HOME;
  } else process.env.HOME = ORIGINAL_HOME;
}

describe('install-autostart', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-autostart-'));
    setHome(root);
    execFileSyncMock.mockReset();
    // Default: `which` for node resolution, etc. should be inert. Most
    // tests pass nodePath / minspectBinPath explicitly, so `which` is
    // never called. We do need `id -u` to "succeed" in the macOS path
    // to keep the executor from bailing on the empty uid; mock returns
    // a uid so the bootstrap target string is well-formed.
    execFileSyncMock.mockImplementation((cmd: string, args: string[] = []) => {
      if (cmd === 'id' && args[0] === '-u') return Buffer.from('501\n');
      if (cmd === 'launchctl' && args[0] === 'list')
        return Buffer.from('com.ivenlau.minspect\t501\t...\n');
      if (cmd === 'systemctl' && args[0] === '--user' && args[1] === 'is-active')
        return Buffer.from('active\n');
      if (cmd === 'schtasks' && args[0] === '/Query') return Buffer.from('Success\n');
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

  it('returns unsupported when caller requests an unsupported backend explicitly', () => {
    expect(() =>
      runInstallAutostart({
        stateRoot: root,
        nodePath: '/n',
        minspectBinPath: '/m',
        backend: 'unsupported',
      }),
    ).toThrow(/not supported/);
  });

  it('throws when node path cannot be resolved', () => {
    // `process.execPath` is set by the test runner; the only way to
    // make `resolveNodePath` return null is to mock execFileSync to
    // throw (so `which` also fails), and trust that production runs
    // without `process.execPath` will surface the same error.
    const originalExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '', configurable: true });
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    try {
      expect(() =>
        runInstallAutostart({
          stateRoot: root,
          minspectBinPath: '/m',
          // nodePath omitted → falls through to resolver, which throws
        }),
      ).toThrow(/node/i);
    } finally {
      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        configurable: true,
      });
    }
  });

  it('throws when minspect bin path cannot be resolved', () => {
    // Wipe argv[1] so `resolveMinspectBinPath` falls through to the
    // `which minspect` lookup; mock that to throw.
    const originalArgv1 = process.argv[1];
    process.argv[1] = '';
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    try {
      expect(() =>
        runInstallAutostart({
          stateRoot: root,
          nodePath: '/n',
        }),
      ).toThrow(/minspect/i);
    } finally {
      if (originalArgv1 !== undefined) process.argv[1] = originalArgv1;
    }
  });

  it('dry-run does not write any files', () => {
    setPlatform('darwin');
    const r = runInstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      dryRun: true,
    });
    expect(r.backend).toBe('launchd');
    expect(r.enabled).toBe(false);
    expect(r.started).toBe(false);
    expect(existsSync(launchdPlistPath())).toBe(false);
    expect(r.enableCommand?.cmd).toBe('launchctl');
  });

  it('macOS: writes plist and calls launchctl bootstrap', () => {
    setPlatform('darwin');
    const r = runInstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
    });
    expect(r.backend).toBe('launchd');
    expect(r.unitPath).toBe(launchdPlistPath());
    expect(r.enabled).toBe(true);
    const body = readFileSync(r.unitPath, 'utf8');
    expect(body).toContain('com.ivenlau.minspect');
    expect(body).toContain('<string>/n</string>');
    expect(body).toContain('<string>/m</string>');
    expect(body).toContain('<string>serve</string>');
    expect(body).toContain('<string>--quiet</string>');
    expect(body).toContain('<key>SuccessfulExit</key>');
    // launchctl bootstrap was called
    const calls = execFileSyncMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain('launchctl');
  });

  it('macOS: persists autostart=true in config.json by default', () => {
    setPlatform('darwin');
    runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(readConfig(root).autostart).toBe(true);
  });

  it('macOS: persist=false does not touch config', () => {
    setPlatform('darwin');
    runInstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      persist: false,
    });
    expect(readConfig(root).autostart).toBeUndefined();
  });

  it('Linux with systemd: writes service unit and calls systemctl --user enable --now', () => {
    setPlatform('linux');
    const r = runInstallAutostart({
      stateRoot: root,
      nodePath: '/n',
      minspectBinPath: '/m',
      backend: 'systemd',
    });
    expect(r.backend).toBe('systemd');
    expect(r.unitPath).toBe(systemdUnitPath());
    const body = readFileSync(r.unitPath, 'utf8');
    expect(body).toContain('[Unit]');
    expect(body).toContain('ExecStart=/n /m serve --quiet');
    expect(body).toContain('Restart=on-failure');
    const calls = execFileSyncMock.mock.calls
      .filter((c) => c[0] === 'systemctl')
      .map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((s) => s.includes('enable --now'))).toBe(true);
  });

  it('Linux without systemd: falls back to xdg-autostart desktop file', () => {
    setPlatform('linux');
    // Pretend systemctl exists on PATH but the user bus is not
    // reachable — `show-environment` exits non-zero.
    execFileSyncMock.mockImplementation((cmd: string, args: string[] = []) => {
      if (cmd === 'which' || cmd === 'where') return Buffer.from('/usr/bin/systemctl\n');
      if (cmd === 'systemctl' && args[0] === '--user' && args[1] === 'show-environment') {
        throw new Error('Failed to connect to bus');
      }
      return Buffer.from('');
    });

    const r = runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(r.backend).toBe('xdg-autostart');
    expect(r.unitPath).toBe(xdgAutostartDesktopPath());
    const body = readFileSync(r.unitPath, 'utf8');
    expect(body).toContain('[Desktop Entry]');
    expect(body).toContain('Exec=/n /m serve --quiet');
    expect(body).toContain('X-GNOME-Autostart-enabled=true');
  });

  it('Windows: registers a Task Scheduler task via schtasks /Create', () => {
    setPlatform('win32');
    const r = runInstallAutostart({
      stateRoot: root,
      nodePath: 'C:\\n.exe',
      minspectBinPath: 'C:\\m.js',
    });
    expect(r.backend).toBe('scheduled-task');
    expect(r.unitPath).toBe(`\\${scheduledTaskName()}`);
    const calls = execFileSyncMock.mock.calls.filter((c) => c[0] === 'schtasks');
    expect(calls.length).toBeGreaterThan(0);
    const createCall = calls.find((c) => (c[1] as string[])[0] === '/Create');
    expect(createCall).toBeDefined();
    const args = createCall?.[1] as string[];
    expect(args).toContain('/SC');
    expect(args).toContain('ONLOGON');
    expect(args).toContain('/RL');
    expect(args).toContain('LIMITED');
  });

  it('planUninstallAutostart reports installed state without side effects', () => {
    setPlatform('darwin');
    runInstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    // Sanity: file exists post-install.
    expect(existsSync(launchdPlistPath())).toBe(true);
    // Plan only — file should still be there because we only inspected.
    const p = planUninstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(p.backend).toBe('launchd');
    expect(p.wasInstalled).toBe(true);
    expect(existsSync(launchdPlistPath())).toBe(true);
  });

  it('planUninstallAutostart reports not-installed cleanly', () => {
    setPlatform('darwin');
    const p = planUninstallAutostart({ stateRoot: root, nodePath: '/n', minspectBinPath: '/m' });
    expect(p.backend).toBe('launchd');
    expect(p.wasInstalled).toBe(false);
  });
});
