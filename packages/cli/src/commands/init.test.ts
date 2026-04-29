import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readConfig } from '../config.js';
import { runInit } from './init.js';

// All prompts get wired to a deterministic `ask` function so we never hit
// real stdin. Skip `serve` because bringing up the full collector mid-test
// is expensive and orthogonal to what we're asserting here — the tests in
// serve.test.ts own that concern.

describe('runInit', () => {
  let root: string;
  let settingsPath: string;
  let pluginPath: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-init-'));
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

  it('--yes installs everything detected with safe defaults', async () => {
    const result = await runInit({
      yes: true,
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: true, openCodeInstalled: true, codexSessions: false },
      skipServe: true,
      write: () => {
        /* silence */
      },
    });
    expect(result.installed.claudeCode).toBe(true);
    expect(result.installed.openCode).toBe(true);
    expect(result.installed.postCommit).toBe(false); // not a git repo
    expect(result.autoSpawnEnabled).toBe(false); // conservative default under --yes
    // Files touched.
    expect(readFileSync(settingsPath, 'utf8')).toMatch(/__minspect_managed__/);
    expect(readFileSync(pluginPath, 'utf8')).toMatch(/minspect managed/);
    // Config persisted.
    expect(readConfig(root)).toEqual({ auto_spawn_daemon: false });
  });

  it('interactive mode respects user n answers', async () => {
    const asked: string[] = [];
    const ask = async (q: string): Promise<boolean> => {
      asked.push(q);
      return false; // say no to everything
    };
    const result = await runInit({
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: true, openCodeInstalled: true, codexSessions: false },
      ask,
      write: () => {
        /* silence */
      },
      skipServe: true,
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(result.installed.claudeCode).toBe(false);
    expect(result.installed.openCode).toBe(false);
    expect(readConfig(root)).toEqual({ auto_spawn_daemon: false });
  });

  it('skips hook install for already-installed hooks', async () => {
    // Pre-install claude-code. runInit should detect via doctor pre-check and skip.
    const { runInstall } = await import('./install.js');
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/fake/minspect' });

    const asked: string[] = [];
    const result = await runInit({
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: true, openCodeInstalled: false, codexSessions: false },
      ask: async (q) => {
        asked.push(q);
        return true;
      },
      write: () => {
        /* silence */
      },
      skipServe: true,
    });
    // No prompt for claude-code since doctor said it's ok.
    expect(asked.find((q) => /claude code/i.test(q))).toBeUndefined();
    expect(result.installed.claudeCode).toBe(false);
  });

  it('in a git repo, offers post-commit hook', async () => {
    const gitRepo = join(root, 'repo');
    mkdirSync(join(gitRepo, '.git', 'hooks'), { recursive: true });

    const result = await runInit({
      yes: true,
      stateRoot: root,
      cwd: gitRepo,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: false, openCodeInstalled: false, codexSessions: false },
      skipServe: true,
      write: () => {
        /* silence */
      },
    });
    expect(result.installed.postCommit).toBe(true);
    expect(readFileSync(join(gitRepo, '.git', 'hooks', 'post-commit'), 'utf8')).toMatch(
      /minspect managed/,
    );
  });

  it('persists auto_spawn_daemon choice after first run', async () => {
    // First run: user says yes to auto_spawn.
    await runInit({
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: false, openCodeInstalled: false, codexSessions: false },
      ask: async (q) => /auto-start/i.test(q),
      write: () => {
        /* silence */
      },
      skipServe: true,
    });
    expect(readConfig(root).auto_spawn_daemon).toBe(true);

    // Second run: should NOT re-ask, just keep existing value. Any ask call
    // would flip the answer via our matcher, so we assert by counting.
    let autoSpawnAsks = 0;
    await runInit({
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: false, openCodeInstalled: false, codexSessions: false },
      ask: async (q) => {
        if (/auto-start/i.test(q)) autoSpawnAsks += 1;
        return false;
      },
      write: () => {
        /* silence */
      },
      skipServe: true,
    });
    expect(autoSpawnAsks).toBe(0);
    expect(readConfig(root).auto_spawn_daemon).toBe(true);
  });

  it('handles --yes without any detected agent (noop happy path)', async () => {
    const result = await runInit({
      yes: true,
      stateRoot: root,
      cwd,
      settingsPath,
      opencodePluginPath: pluginPath,
      aiHistoryBin: '/fake/minspect',
      detect: { claudeCodeInstalled: false, openCodeInstalled: false, codexSessions: false },
      skipServe: true,
      write: () => {
        /* silence */
      },
    });
    expect(result.installed.claudeCode).toBe(false);
    expect(result.installed.openCode).toBe(false);
    // auto_spawn default written.
    expect(readConfig(root).auto_spawn_daemon).toBe(false);
  });
});
