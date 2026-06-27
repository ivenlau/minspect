import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { readConfig, writeConfig } from '../config.js';
import { runDoctor } from './doctor.js';
import { runImportCodexAll } from './import-codex.js';
import { runInstallAutostart } from './install-autostart.js';
import { runInstallOpenCode } from './install-opencode.js';
import { installPostCommitHook } from './install-post-commit-hook.js';
import { runInstall } from './install.js';
import {
  type RunningDaemon,
  findRunningDaemon,
  openBrowser,
  spawnServeDetached,
  waitForDaemonReady,
} from './serve.js';

// Orchestrator that takes a user from "just installed minspect" to "UI open,
// agents wired up, daemon running" in one command. Every step is optional
// (interactively opt-in, or opt-out with --yes) and reuses the same
// operations as the dedicated commands, so calling init is never different
// from running the steps by hand.

export interface InitOptions {
  yes?: boolean; // non-interactive: accept safe defaults
  stateRoot?: string;
  cwd?: string;
  // Test hooks
  ask?: (question: string, defaultYes: boolean) => Promise<boolean>;
  write?: (line: string) => void;
  // Inject detection overrides for unit tests so we don't touch the real
  // homedir / filesystem.
  detect?: {
    claudeCodeInstalled?: boolean;
    openCodeInstalled?: boolean;
    codexSessions?: boolean;
  };
  // Path overrides forwarded to install*.
  settingsPath?: string;
  opencodePluginPath?: string;
  aiHistoryBin?: string;
  // Skip actually starting the daemon (tests).
  skipServe?: boolean;
  // Suppress the browser open. Default true during tests.
  noOpen?: boolean;
  // Test seams for the detach-spawn flow. Defaults call the real helpers
  // in serve.ts; tests inject stubs to avoid touching real processes.
  findRunningDaemon?: (stateRoot?: string) => Promise<RunningDaemon | null>;
  spawnServe?: () => { pid: number } | null;
  waitForDaemon?: (stateRoot?: string) => Promise<RunningDaemon | null>;
  openBrowser?: (url: string) => void;
}

export interface InitResult {
  installed: {
    claudeCode: boolean;
    openCode: boolean;
    postCommit: boolean;
  };
  importedCodex: number; // files imported, 0 if skipped
  autoSpawnEnabled: boolean;
  autostartEnabled: boolean;
  daemonStarted: boolean;
  port?: number;
}

// Default agent detection. Presence of the settings.json / plugin dir /
// sessions dir is our "probably installed" signal — good enough for an
// interactive prompt; the user confirms before we touch anything.
function defaultDetect() {
  const claude = join(homedir(), '.claude', 'settings.json');
  const opencode = join(homedir(), '.config', 'opencode');
  const codex = join(homedir(), '.codex', 'sessions');
  return {
    claudeCodeInstalled: existsSync(claude),
    openCodeInstalled: existsSync(opencode),
    codexSessions: existsSync(codex),
  };
}

async function defaultAsk(question: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

// Shared detach-spawn block used by both `minspect init` (end of setup)
// and `minspect start` (standalone daemon restart). The `init` flow calls
// it inline; the standalone command wraps it with a tiny CLI shim in
// `start.ts`. Behavior: probe for an already-running daemon, fall through
// to spawn if not, wait up to 5s for `/health`, and optionally open the
// browser on success. Test seams (find / spawnServe / waitForDaemon /
// openBrowser) let unit tests skip real process spawn.
export interface StartDaemonOptions {
  stateRoot?: string;
  spawnedBy?: 'init' | 'user' | 'hook';
  openBrowser?: boolean;
  findRunningDaemon?: (stateRoot?: string) => Promise<RunningDaemon | null>;
  spawnServe?: () => { pid: number } | null;
  waitForDaemon?: (stateRoot?: string) => Promise<RunningDaemon | null>;
  openBrowserFn?: (url: string) => void;
}

export interface StartDaemonResult {
  daemonStarted: boolean;
  port?: number;
  spawned: boolean; // true if we actually fork()'d, false if reused existing
  // When `spawned` is true and `daemonStarted` is false, this distinguishes
  // "spawn() returned null" from "spawn succeeded but /health never 200'd".
  // Both are user-visible failures but with different fix hints.
  spawnFailed: boolean;
}

export async function runStartDaemonDetached(
  options: StartDaemonOptions = {},
): Promise<StartDaemonResult> {
  const find = options.findRunningDaemon ?? findRunningDaemon;
  const spawnFn =
    options.spawnServe ?? (() => spawnServeDetached({ spawnedBy: options.spawnedBy ?? 'user' }));
  const waitFn =
    options.waitForDaemon ?? ((root) => waitForDaemonReady({ stateRoot: root, timeoutMs: 5000 }));
  const openFn = options.openBrowserFn ?? ((url: string) => void openBrowser(url));

  const existing = await find(options.stateRoot);
  if (existing) {
    if (options.openBrowser) openFn(`http://127.0.0.1:${existing.port}`);
    return { daemonStarted: true, port: existing.port, spawned: false, spawnFailed: false };
  }

  const spawned = spawnFn();
  if (!spawned) {
    return { daemonStarted: false, spawned: true, spawnFailed: true };
  }

  const ready = await waitFn(options.stateRoot);
  if (!ready) {
    return { daemonStarted: false, spawned: true, spawnFailed: false };
  }

  if (options.openBrowser) openFn(`http://127.0.0.1:${ready.port}`);
  return { daemonStarted: true, port: ready.port, spawned: true, spawnFailed: false };
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const write = options.write ?? defaultWrite;
  const ask = options.ask ?? defaultAsk;
  const cwd = options.cwd ?? process.cwd();
  const detected = options.detect ?? defaultDetect();

  write('minspect init');
  write('');

  // Up-front diagnostic pass so users see what's already wired vs missing.
  const pre = await runDoctor({
    stateRoot: options.stateRoot,
    settingsPath: options.settingsPath,
    opencodePluginPath: options.opencodePluginPath,
    cwd,
  });
  for (const c of pre.checks) {
    const sigil = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    write(`  ${sigil} ${c.id}: ${c.message}`);
  }
  write('');

  const result: InitResult = {
    installed: { claudeCode: false, openCode: false, postCommit: false },
    importedCodex: 0,
    autoSpawnEnabled: false,
    autostartEnabled: false,
    daemonStarted: false,
  };

  // --- Agent: Claude Code --------------------------------------------------
  const claudeAlreadyInstalled =
    pre.checks.find((c) => c.id === 'hook-claude-code')?.status === 'ok';
  if (detected.claudeCodeInstalled && !claudeAlreadyInstalled) {
    const shouldInstall = options.yes ? true : await ask('Install Claude Code hook?', true);
    if (shouldInstall) {
      const r = runInstall({
        agent: 'claude-code',
        settingsPath: options.settingsPath,
        aiHistoryBin: options.aiHistoryBin,
      });
      write(`  installed claude-code hook → ${r.path}`);
      if (r.backup) write(`    backup: ${r.backup}`);
      result.installed.claudeCode = true;
    }
  } else if (claudeAlreadyInstalled) {
    write('  claude-code hook already installed — skipping');
  }

  // --- Agent: OpenCode -----------------------------------------------------
  const opencodeAlreadyInstalled =
    pre.checks.find((c) => c.id === 'hook-opencode')?.status === 'ok';
  if (detected.openCodeInstalled && !opencodeAlreadyInstalled) {
    const shouldInstall = options.yes ? true : await ask('Install OpenCode plugin?', true);
    if (shouldInstall) {
      const r = runInstallOpenCode({
        pluginPath: options.opencodePluginPath,
        aiHistoryBin: options.aiHistoryBin,
      });
      write(`  installed opencode plugin → ${r.path}`);
      if (r.backup) write(`    backup: ${r.backup}`);
      result.installed.openCode = true;
    }
  } else if (opencodeAlreadyInstalled) {
    write('  opencode plugin already installed — skipping');
  }

  // --- Agent: Codex (import-only, no hook) --------------------------------
  if (detected.codexSessions) {
    const shouldImport = options.yes
      ? false // conservative default — can take a while for heavy users
      : await ask('Import the last 30 days of Codex sessions?', true);
    if (shouldImport) {
      try {
        const r = await runImportCodexAll({ since: '30d' });
        write(`  imported ${r.files_imported}/${r.files_scanned} codex sessions`);
        result.importedCodex = r.files_imported;
      } catch (e) {
        write(`  codex import failed: ${(e as Error).message}`);
      }
    }
  }

  // --- Post-commit hook (only if cwd is a git repo) -----------------------
  const isGit = existsSync(join(cwd, '.git'));
  if (isGit) {
    const hookPath = join(cwd, '.git', 'hooks', 'post-commit');
    const alreadyManaged =
      existsSync(hookPath) &&
      (await import('node:fs')).readFileSync(hookPath, 'utf8').includes('minspect managed');
    if (!alreadyManaged) {
      const shouldInstall = options.yes
        ? true
        : await ask(`Install post-commit hook in ${cwd}?`, true);
      if (shouldInstall) {
        try {
          const r = installPostCommitHook({
            repoRoot: cwd,
            aiHistoryBin: options.aiHistoryBin ?? 'minspect',
          });
          write(`  ${r.created ? 'wrote' : 'updated'} ${r.path}`);
          if (r.backup) write(`    backup: ${r.backup}`);
          result.installed.postCommit = true;
        } catch (e) {
          write(`  post-commit install failed: ${(e as Error).message}`);
        }
      }
    } else {
      write('  post-commit hook already installed — skipping');
    }
  }

  // --- Auto-spawn daemon preference ---------------------------------------
  // Asked once, then persisted to config.json. Users can flip it any time
  // by editing that file; we don't re-prompt on repeat init runs.
  const cfg = readConfig(options.stateRoot);
  if (cfg.auto_spawn_daemon === undefined) {
    const enable = options.yes
      ? false // conservative default — don't silently spawn background processes
      : await ask(
          "Let hooks auto-start the daemon when it's not running? (recommended for casual use)",
          false,
        );
    writeConfig({ ...cfg, auto_spawn_daemon: enable }, options.stateRoot);
    result.autoSpawnEnabled = enable;
    write(`  auto_spawn_daemon: ${enable}`);
  } else {
    result.autoSpawnEnabled = cfg.auto_spawn_daemon === true;
    write(`  auto_spawn_daemon: ${cfg.auto_spawn_daemon} (unchanged)`);
  }

  // --- OS-level autostart (login item) -----------------------------------
  // Independent from auto_spawn_daemon: this one writes a per-user
  // LaunchAgent / systemd --user unit / HKCU Run key value so the
  // daemon comes up after the user logs in, without any agent having to
  // fire first. We default `--yes` to true (opposite of auto_spawn) —
  // the registration is visible to the user (launchctl list / systemctl
  // --user list / reg query) and is reversible via
  // `minspect uninstall-autostart` or `uninstall --all`.
  //
  // If the install throws (e.g. reg.exe failing on Windows with a
  // permission error), we record autostart as `false` in config — never
  // `true`. The previous shape wrote the user's "enable" choice even on
  // failure, which made `minspect status` / `doctor` report "ok" forever
  // even though no unit was actually registered. Recording the real
  // state means the next status / doctor run surfaces the gap.
  if (cfg.autostart === undefined) {
    const enable = options.yes
      ? true
      : await ask('Start the daemon automatically when you log in? (recommended)', true);
    let actuallyEnabled = false;
    if (enable) {
      try {
        const r = runInstallAutostart({
          stateRoot: options.stateRoot,
          minspectBinPath: options.aiHistoryBin,
          persist: false, // we just wrote the explicit flag below
        });
        actuallyEnabled = true;
        result.autostartEnabled = true;
        write(`  autostart: ${r.backend} → ${r.unitPath} (started: ${r.started})`);
      } catch (e) {
        write(`  autostart install failed: ${(e as Error).message}`);
        write(
          '    fix: run `minspect install-autostart` to retry, or `minspect doctor` for details',
        );
      }
    } else {
      write('  autostart: disabled');
    }
    writeConfig(
      { ...readConfig(options.stateRoot), autostart: actuallyEnabled },
      options.stateRoot,
    );
  } else {
    result.autostartEnabled = cfg.autostart === true;
    write(`  autostart: ${cfg.autostart} (unchanged)`);
  }

  // --- Start the daemon ---------------------------------------------------
  // Detach-spawn so `minspect init` can exit cleanly and leave the daemon
  // running in the background. The user can close this terminal without
  // killing the server (the old inline `runServe` held the daemon hostage
  // to the cmd window). Delegates to `runStartDaemonDetached` so the
  // standalone `minspect start` command can reuse the exact same flow.
  if (!options.skipServe) {
    write('');
    const r = await runStartDaemonDetached({
      stateRoot: options.stateRoot,
      spawnedBy: 'init',
      openBrowser: !(options.noOpen ?? false),
      findRunningDaemon: options.findRunningDaemon,
      spawnServe: options.spawnServe,
      waitForDaemon: options.waitForDaemon,
      openBrowserFn: options.openBrowser,
    });
    if (r.daemonStarted && r.port !== undefined) {
      const live = await findRunningDaemon(options.stateRoot);
      const pid = live?.pid ?? '?';
      if (r.spawned) {
        write(`daemon: http://127.0.0.1:${r.port} (pid ${pid})`);
      } else {
        write(`daemon already running on http://127.0.0.1:${r.port} (pid ${pid})`);
      }
      result.daemonStarted = true;
      result.port = r.port;
    } else if (r.spawnFailed) {
      write("  couldn't spawn daemon; run 'minspect serve' manually to see errors");
    } else {
      write("  daemon did not come up within 5s; run 'minspect serve' manually to see errors");
    }
  }

  write('');
  write('done.');
  return result;
}
