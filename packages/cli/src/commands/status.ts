import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStateDir } from '../paths.js';
import { BEGIN_MARKER as OPENCODE_BEGIN } from './install-opencode.js';
import { MARKER as CLAUDE_MARKER } from './install.js';
import { DEFAULT_PORT } from './serve.js';

// Thin read-only command: shows where the daemon is and whether the obvious
// hooks are installed. Pure status — never mutates anything. When invoked
// with no other command (bin.ts default action), this is what the user
// sees, so keep the output scannable in 5 lines.

export interface StatusReport {
  initialized: boolean; // has either state.json or any hook been seen?
  daemon:
    | {
        state: 'running';
        port: number;
        pid: number;
        spawnedBy?: 'user' | 'init' | 'hook';
      }
    | {
        state: 'stopped';
        port: number; // the port the stale state.json claimed
      }
    | { state: 'none' };
  queue: { queue: number; poisoned: number } | null;
  lastEventAgeMs: number | null; // null = no events ever
  hooks: {
    claudeCode: boolean;
    openCode: boolean;
  };
}

export interface StatusOptions {
  stateRoot?: string;
  settingsPath?: string;
  opencodePluginPath?: string;
}

async function probeJson<T>(url: string, timeoutMs = 800): Promise<T | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function defaultClaudeSettings(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function defaultOpenCodePlugin(): string {
  return join(homedir(), '.config', 'opencode', 'plugins', 'minspect.ts');
}

function hookInstalledClaudeCode(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    return readFileSync(settingsPath, 'utf8').includes(CLAUDE_MARKER);
  } catch {
    return false;
  }
}

function hookInstalledOpenCode(pluginPath: string): boolean {
  if (!existsSync(pluginPath)) return false;
  try {
    return readFileSync(pluginPath, 'utf8').includes(OPENCODE_BEGIN);
  } catch {
    return false;
  }
}

export async function runStatus(options: StatusOptions = {}): Promise<StatusReport> {
  const stateRoot = options.stateRoot ?? getStateDir();
  const settingsPath = options.settingsPath ?? defaultClaudeSettings();
  const pluginPath = options.opencodePluginPath ?? defaultOpenCodePlugin();

  const hooks = {
    claudeCode: hookInstalledClaudeCode(settingsPath),
    openCode: hookInstalledOpenCode(pluginPath),
  };

  const statePath = join(stateRoot, 'state.json');
  if (!existsSync(statePath)) {
    return {
      initialized: hooks.claudeCode || hooks.openCode,
      daemon: { state: 'none' },
      queue: null,
      lastEventAgeMs: null,
      hooks,
    };
  }

  let daemonJson: { port?: number; pid?: number } | null;
  try {
    daemonJson = JSON.parse(readFileSync(statePath, 'utf8')) as {
      port?: number;
      pid?: number;
    };
  } catch {
    daemonJson = null;
  }
  const port = daemonJson?.port ?? 0;
  const build = port
    ? await probeJson<{ spawned_by?: 'user' | 'init' | 'hook' }>(
        `http://127.0.0.1:${port}/api/build-info`,
      )
    : null;
  const health = port
    ? await probeJson<{ status: string }>(`http://127.0.0.1:${port}/health`)
    : null;
  if (!build || !health) {
    return {
      initialized: true,
      daemon: { state: 'stopped', port },
      queue: null,
      lastEventAgeMs: null,
      hooks,
    };
  }

  const queue = await probeJson<{ queue: number; poisoned: number }>(
    `http://127.0.0.1:${port}/api/queue-stats`,
  );
  const sessions = await probeJson<{
    sessions?: Array<{ started_at?: number; ended_at?: number }>;
  }>(`http://127.0.0.1:${port}/api/sessions`);
  const latest = (sessions?.sessions ?? [])
    .map((s) => Math.max(s.started_at ?? 0, s.ended_at ?? 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const lastEventAgeMs = latest > 0 ? Date.now() - latest : null;

  return {
    initialized: true,
    daemon: {
      state: 'running',
      port,
      pid: daemonJson?.pid ?? 0,
      spawnedBy: build.spawned_by,
    },
    queue,
    lastEventAgeMs,
    hooks,
  };
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];
  if (!report.initialized) {
    lines.push('minspect: not initialized');
    lines.push('  run `minspect init` to install hooks and start the UI');
    return `${lines.join('\n')}\n`;
  }
  switch (report.daemon.state) {
    case 'running': {
      const spawnTag =
        report.daemon.spawnedBy && report.daemon.spawnedBy !== 'user'
          ? ` (spawned_by: ${report.daemon.spawnedBy})`
          : '';
      lines.push(
        `daemon:   http://127.0.0.1:${report.daemon.port}  pid ${report.daemon.pid}${spawnTag}`,
      );
      break;
    }
    case 'stopped':
      lines.push(
        `daemon:   stopped (state.json says port ${report.daemon.port}); run \`minspect serve\``,
      );
      break;
    case 'none':
      lines.push(`daemon:   not running; run \`minspect serve\` (default port ${DEFAULT_PORT})`);
      break;
  }
  if (report.queue) {
    lines.push(`queue:    ${report.queue.queue}  poisoned: ${report.queue.poisoned}`);
  }
  if (report.lastEventAgeMs == null) {
    lines.push('last:     no events yet');
  } else {
    lines.push(`last:     ${formatAge(report.lastEventAgeMs)} ago`);
  }
  const claudeSig = report.hooks.claudeCode ? '✓' : '✗';
  const opencodeSig = report.hooks.openCode ? '✓' : '✗';
  lines.push(`hooks:    claude-code ${claudeSig}   opencode ${opencodeSig}`);
  return `${lines.join('\n')}\n`;
}
