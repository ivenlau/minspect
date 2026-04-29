import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { runInstallOpenCode } from './install-opencode.js';
import { installPostCommitHook } from './install-post-commit-hook.js';
import { runInstall } from './install.js';

describe('runDoctor', () => {
  let root: string;
  let settingsPath: string;
  let pluginPath: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-doctor-'));
    settingsPath = join(root, 'claude', 'settings.json');
    pluginPath = join(root, 'opencode', 'plugins', 'minspect.ts');
    cwd = join(root, 'notagit');
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('fresh machine: state dir missing, daemon off, hooks not installed', async () => {
    const report = await runDoctor({
      stateRoot: join(root, 'no-state'),
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    const byId = (id: string) => report.checks.find((c) => c.id === id);
    expect(byId('node')?.status).toBe('ok'); // Node 20+ assumed for CI
    expect(byId('state-dir')?.status).toBe('warn');
    expect(byId('daemon')?.status).toBe('warn');
    expect(byId('hook-claude-code')?.status).toBe('warn');
    expect(byId('hook-opencode')?.status).toBe('warn');
    expect(byId('hook-post-commit')?.status).toBe('ok'); // not a git repo → skip
    expect(byId('db')?.status).toBe('warn');
    expect(byId('events')?.status).toBe('warn');
    expect(report.summary.fail).toBe(0);
  });

  it('hook check flips to ok after install', async () => {
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });
    runInstallOpenCode({ pluginPath, aiHistoryBin: '/fake/minspect' });

    const report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    const byId = (id: string) => report.checks.find((c) => c.id === id);
    expect(byId('hook-claude-code')?.status).toBe('ok');
    expect(byId('hook-opencode')?.status).toBe('ok');
  });

  it('post-commit check detects repo vs non-repo', async () => {
    mkdirSync(join(cwd, '.git', 'hooks'), { recursive: true });
    let report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    expect(report.checks.find((c) => c.id === 'hook-post-commit')?.status).toBe('warn');

    installPostCommitHook({ repoRoot: cwd, aiHistoryBin: '/fake/minspect' });
    report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    expect(report.checks.find((c) => c.id === 'hook-post-commit')?.status).toBe('ok');
  });

  it('db check: warn when missing, ok when file exists', async () => {
    let report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    expect(report.checks.find((c) => c.id === 'db')?.status).toBe('warn');

    writeFileSync(join(root, 'history.sqlite'), 'x');
    report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    expect(report.checks.find((c) => c.id === 'db')?.status).toBe('ok');
  });

  it('daemon.json with stale port: fail (unreachable /health)', async () => {
    // Port 1 is reserved and should be unreachable for /health.
    writeFileSync(join(root, 'state.json'), JSON.stringify({ port: 1, pid: 999999 }));
    const report = await runDoctor({
      stateRoot: root,
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    const d = report.checks.find((c) => c.id === 'daemon');
    expect(d?.status).toBe('fail');
    expect(report.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it('formatDoctorReport produces plain text with sigils + summary line', async () => {
    const report = await runDoctor({
      stateRoot: join(root, 'no-state'),
      settingsPath,
      opencodePluginPath: pluginPath,
      cwd,
    });
    const text = formatDoctorReport(report);
    expect(text).toMatch(/summary: \d+ ok · \d+ warn · \d+ fail/);
    expect(text).toMatch(/^[✓⚠✗] /m);
  });
});
