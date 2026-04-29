import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BEGIN_MARKER as OC_BEGIN,
  END_MARKER as OC_END,
  runInstallOpenCode,
} from './install-opencode.js';
import { installPostCommitHook } from './install-post-commit-hook.js';
import { runInstall } from './install.js';
import { runUninstall } from './uninstall.js';

describe('runUninstall', () => {
  let root: string;
  let settingsPath: string;
  let pluginPath: string;
  let repoRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-uninstall-'));
    settingsPath = join(root, 'claude', 'settings.json');
    pluginPath = join(root, 'opencode', 'plugins', 'minspect.ts');
    repoRoot = join(root, 'repo');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('requires --agent or --all', async () => {
    await expect(runUninstall({})).rejects.toThrow(/--agent/);
  });

  it('dry-run by default; does not write', async () => {
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });
    const before = readFileSync(settingsPath, 'utf8');
    const res = await runUninstall({ agent: 'claude-code', settingsPath });
    expect(res.dryRun).toBe(true);
    expect(res.steps[0]?.kind).toBe('claude-code-settings');
    expect(res.steps[0]?.detail).toMatch(/remove \d+ managed/);
    expect(readFileSync(settingsPath, 'utf8')).toBe(before);
  });

  it('strips managed Claude Code hooks with --yes, keeps user hooks', async () => {
    mkdirSync(join(root, 'claude'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: '/bin/echo user' }] }],
          },
        },
        null,
        2,
      ),
    );
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });
    expect(readFileSync(settingsPath, 'utf8')).toMatch(/__minspect_managed__/);

    const res = await runUninstall({ agent: 'claude-code', settingsPath, yes: true });
    expect(res.dryRun).toBe(false);
    expect(res.steps[0]?.result).toBe('stripped');
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, unknown[]>;
    };
    expect(after.hooks?.SessionStart).toEqual([
      { hooks: [{ type: 'command', command: '/bin/echo user' }] },
    ]);
    expect(JSON.stringify(after)).not.toMatch(/__minspect_managed__/);
  });

  it('re-run is idempotent (no managed hooks -> skipped/no-op)', async () => {
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });
    await runUninstall({ agent: 'claude-code', settingsPath, yes: true });
    const second = await runUninstall({ agent: 'claude-code', settingsPath, yes: true });
    expect(second.steps[0]?.detail).toMatch(/no managed hooks/);
    expect(second.steps[0]?.result).toBe('skipped');
  });

  it('deletes OpenCode plugin file when we own the whole file', async () => {
    runInstallOpenCode({ pluginPath, aiHistoryBin: '/fake/minspect' });
    expect(existsSync(pluginPath)).toBe(true);

    const res = await runUninstall({ agent: 'opencode', pluginPath, yes: true });
    expect(res.steps[0]?.kind).toBe('opencode-plugin');
    expect(res.steps[0]?.result).toBe('removed');
    expect(existsSync(pluginPath)).toBe(false);
  });

  it('strips OpenCode managed block but keeps surrounding user code', async () => {
    runInstallOpenCode({ pluginPath, aiHistoryBin: '/fake/minspect' });
    const body = readFileSync(pluginPath, 'utf8');
    // Wrap the managed block in user content on both sides.
    writeFileSync(pluginPath, `// user top\n${body}\n// user bottom\n`);

    const res = await runUninstall({ agent: 'opencode', pluginPath, yes: true });
    expect(res.steps[0]?.result).toBe('stripped');
    const after = readFileSync(pluginPath, 'utf8');
    expect(after).toContain('// user top');
    expect(after).toContain('// user bottom');
    expect(after).not.toContain(OC_BEGIN);
    expect(after).not.toContain(OC_END);
  });

  it('--all removes claude + opencode + post-commit + stops daemon', async () => {
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });
    runInstallOpenCode({ pluginPath, aiHistoryBin: '/fake/minspect' });
    installPostCommitHook({ repoRoot, aiHistoryBin: '/fake/minspect' });

    const res = await runUninstall({
      all: true,
      settingsPath,
      pluginPath,
      repoRoot,
      stateRoot: root, // daemon isn't running; stop-daemon step is a no-op
      yes: true,
    });
    const kinds = res.steps.map((s) => s.kind);
    expect(kinds).toContain('claude-code-settings');
    expect(kinds).toContain('opencode-plugin');
    expect(kinds).toContain('post-commit');
    expect(kinds).toContain('stop-daemon');

    const claude = JSON.parse(readFileSync(settingsPath, 'utf8')) as { hooks?: unknown };
    expect(claude.hooks).toBeUndefined();
    expect(existsSync(pluginPath)).toBe(false);
    expect(existsSync(join(repoRoot, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('post-commit strip preserves surrounding user body', async () => {
    const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
    mkdirSync(join(repoRoot, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho user pre\n');
    installPostCommitHook({ repoRoot, aiHistoryBin: '/fake/minspect' });

    const res = await runUninstall({ all: true, repoRoot, stateRoot: root, yes: true });
    const post = res.steps.find((s) => s.kind === 'post-commit');
    expect(post?.result).toBe('stripped');
    const body = readFileSync(hookPath, 'utf8');
    expect(body).toContain('echo user pre');
    expect(body).not.toContain('minspect managed');
  });

  it('--purge removes state files', async () => {
    // Seed some fake state.
    writeFileSync(join(root, 'history.sqlite'), 'x');
    mkdirSync(join(root, 'sessions'));
    writeFileSync(join(root, 'sessions', 'abc.json'), '{}');
    mkdirSync(join(root, 'queue'));

    const res = await runUninstall({ all: true, purge: true, stateRoot: root, yes: true });
    const purge = res.steps.find((s) => s.kind === 'purge-state');
    expect(purge?.result).toBe('removed');
    expect(existsSync(join(root, 'history.sqlite'))).toBe(false);
    expect(existsSync(join(root, 'sessions'))).toBe(false);
    expect(existsSync(join(root, 'queue'))).toBe(false);
  });

  it('handles missing settings.json gracefully', async () => {
    const res = await runUninstall({
      agent: 'claude-code',
      settingsPath: join(root, 'does-not-exist.json'),
      yes: true,
    });
    expect(res.steps[0]?.detail).toMatch(/no settings.json/);
    expect(res.steps[0]?.result).toBe('skipped');
  });
});
