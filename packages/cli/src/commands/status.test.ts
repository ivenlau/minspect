import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatStatusReport, runStatus } from './status.js';

// All tests use isolated state dirs + fake hook paths so we never touch the
// dev machine's real daemon. We don't spin up a server — the point is to
// verify how status behaves when state.json exists but the daemon is down,
// or when it doesn't exist at all.

describe('runStatus', () => {
  let root: string;
  let settingsPath: string;
  let pluginPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-status-'));
    settingsPath = join(root, 'claude', 'settings.json');
    pluginPath = join(root, 'opencode', 'plugins', 'minspect.ts');
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('fresh machine: not initialized', async () => {
    const report = await runStatus({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
    });
    expect(report.initialized).toBe(false);
    expect(report.daemon.state).toBe('none');
    expect(report.hooks.claudeCode).toBe(false);
    expect(report.hooks.openCode).toBe(false);
  });

  it('renders init hint when not initialized', async () => {
    const report = await runStatus({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
    });
    const text = formatStatusReport(report);
    expect(text).toMatch(/not initialized/);
    expect(text).toMatch(/minspect init/);
  });

  it('detects hooks even without a daemon', async () => {
    const { runInstall } = await import('./install.js');
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });

    const report = await runStatus({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
    });
    expect(report.initialized).toBe(true);
    expect(report.hooks.claudeCode).toBe(true);
    expect(report.daemon.state).toBe('none');
  });

  it('daemon.json with an unreachable port → stopped', async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'state.json'),
      JSON.stringify({ port: 1, pid: 999999, started_at: Date.now() }),
    );
    const report = await runStatus({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
    });
    expect(report.daemon.state).toBe('stopped');
    if (report.daemon.state === 'stopped') {
      expect(report.daemon.port).toBe(1);
    }
    const text = formatStatusReport(report);
    expect(text).toMatch(/stopped/);
    expect(text).toMatch(/minspect serve/);
  });

  it('formatStatusReport output is plain text and compact (≤ 6 lines when running)', () => {
    const text = formatStatusReport({
      initialized: true,
      daemon: { state: 'running', port: 21477, pid: 42, spawnedBy: 'user' },
      queue: { queue: 0, poisoned: 0 },
      lastEventAgeMs: 2000,
      hooks: { claudeCode: true, openCode: false },
    });
    expect(text.trim().split('\n').length).toBeLessThanOrEqual(6);
    expect(text).toMatch(/http:\/\/127\.0\.0\.1:21477/);
    expect(text).toMatch(/last:\s+2s ago/);
  });

  it('renders spawned_by tag when daemon was auto-started by a hook', () => {
    const text = formatStatusReport({
      initialized: true,
      daemon: { state: 'running', port: 21477, pid: 42, spawnedBy: 'hook' },
      queue: { queue: 0, poisoned: 0 },
      lastEventAgeMs: null,
      hooks: { claudeCode: true, openCode: false },
    });
    expect(text).toMatch(/spawned_by: hook/);
  });
});
