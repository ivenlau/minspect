import { constants, accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStateDir } from '../paths.js';
import { BEGIN_MARKER as OPENCODE_BEGIN } from './install-opencode.js';
import { MARKER as CLAUDE_MARKER } from './install.js';
import { DEFAULT_PORT } from './serve.js';

// Runs a fixed set of checks and returns a structured report. Every check
// returns {status, message, fix?} so both the human text renderer and the
// --json consumer speak the same vocabulary. Checks are independent and
// cheap (1s timeout on network probes) so doctor never hangs the terminal.

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
}

export interface DoctorOptions {
  stateRoot?: string;
  settingsPath?: string;
  opencodePluginPath?: string;
  cwd?: string;
  /** Override state-dir "recent event" threshold in ms (tests). */
  recentWindowMs?: number;
}

const DEFAULT_RECENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkNode(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (Number.isFinite(major) && major >= 20) {
    return { id: 'node', status: 'ok', message: `Node ${process.versions.node}` };
  }
  return {
    id: 'node',
    status: 'fail',
    message: `Node ${process.versions.node} (need ≥ 20)`,
    fix: 'upgrade Node.js to 20+',
  };
}

function checkStateDir(stateRoot: string): DoctorCheck {
  if (!existsSync(stateRoot)) {
    return {
      id: 'state-dir',
      status: 'warn',
      message: `${stateRoot} does not exist yet`,
      fix: 'run `minspect serve` to create it',
    };
  }
  try {
    accessSync(stateRoot, constants.R_OK | constants.W_OK);
    return { id: 'state-dir', status: 'ok', message: stateRoot };
  } catch {
    return {
      id: 'state-dir',
      status: 'fail',
      message: `${stateRoot} not writable`,
      fix: 'check permissions / disk space',
    };
  }
}

interface DaemonJson {
  port?: number;
  pid?: number;
  started_at?: number;
}

function readDaemonJson(stateRoot: string): DaemonJson | null {
  const p = join(stateRoot, 'state.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DaemonJson;
  } catch {
    return null;
  }
}

async function probeUrl(url: string, timeoutMs = 1000): Promise<boolean> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

async function checkDaemon(stateRoot: string): Promise<DoctorCheck> {
  const daemon = readDaemonJson(stateRoot);
  if (!daemon || !daemon.port) {
    return {
      id: 'daemon',
      status: 'warn',
      message: 'not running',
      fix: `run \`minspect serve\` (will listen on ${DEFAULT_PORT})`,
    };
  }
  const healthy = await probeUrl(`http://127.0.0.1:${daemon.port}/health`);
  if (healthy) {
    return {
      id: 'daemon',
      status: 'ok',
      message: `running on http://127.0.0.1:${daemon.port} (pid ${daemon.pid})`,
    };
  }
  return {
    id: 'daemon',
    status: 'fail',
    message: `state.json says port ${daemon.port} but /health unreachable`,
    fix: 'run `minspect stop` to clear stale state, then `minspect serve`',
  };
}

function defaultClaudeSettings(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function defaultOpenCodePlugin(): string {
  return join(homedir(), '.config', 'opencode', 'plugins', 'minspect.ts');
}

function checkClaudeHook(settingsPath: string): DoctorCheck {
  if (!existsSync(settingsPath)) {
    return {
      id: 'hook-claude-code',
      status: 'warn',
      message: 'Claude Code settings.json not found',
      fix: 'if you use Claude Code, run `minspect install --agent claude-code`',
    };
  }
  let body: string;
  try {
    body = readFileSync(settingsPath, 'utf8');
  } catch (e) {
    return {
      id: 'hook-claude-code',
      status: 'fail',
      message: `unreadable: ${(e as Error).message}`,
    };
  }
  if (body.includes(CLAUDE_MARKER)) {
    return { id: 'hook-claude-code', status: 'ok', message: 'installed' };
  }
  return {
    id: 'hook-claude-code',
    status: 'warn',
    message: 'settings.json present, but no minspect hook block',
    fix: 'run `minspect install --agent claude-code`',
  };
}

function checkOpenCodePlugin(pluginPath: string): DoctorCheck {
  if (!existsSync(pluginPath)) {
    return {
      id: 'hook-opencode',
      status: 'warn',
      message: 'OpenCode plugin not installed (skip if you do not use OpenCode)',
      fix: 'run `minspect install --agent opencode` if applicable',
    };
  }
  let body: string;
  try {
    body = readFileSync(pluginPath, 'utf8');
  } catch (e) {
    return {
      id: 'hook-opencode',
      status: 'fail',
      message: `unreadable: ${(e as Error).message}`,
    };
  }
  if (body.includes(OPENCODE_BEGIN)) {
    return { id: 'hook-opencode', status: 'ok', message: 'installed' };
  }
  return {
    id: 'hook-opencode',
    status: 'warn',
    message: 'plugin file exists but lacks minspect managed block',
    fix: 'run `minspect install --agent opencode` to overwrite',
  };
}

function checkPostCommit(cwd: string): DoctorCheck {
  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return {
      id: 'hook-post-commit',
      status: 'ok',
      message: 'skip (not a git repo)',
    };
  }
  const hookPath = join(gitDir, 'hooks', 'post-commit');
  if (!existsSync(hookPath)) {
    return {
      id: 'hook-post-commit',
      status: 'warn',
      message: 'git repo, no post-commit hook',
      fix: 'run `minspect install-post-commit-hook`',
    };
  }
  const body = readFileSync(hookPath, 'utf8');
  if (body.includes('minspect managed')) {
    return { id: 'hook-post-commit', status: 'ok', message: 'installed' };
  }
  return {
    id: 'hook-post-commit',
    status: 'warn',
    message: 'post-commit exists but does not call minspect',
    fix: 'run `minspect install-post-commit-hook` to append',
  };
}

function checkDatabase(stateRoot: string): DoctorCheck {
  const dbPath = join(stateRoot, 'history.sqlite');
  if (!existsSync(dbPath)) {
    return {
      id: 'db',
      status: 'warn',
      message: 'history.sqlite not created yet',
      fix: 'run `minspect serve` once to initialize',
    };
  }
  try {
    const size = statSync(dbPath).size;
    return { id: 'db', status: 'ok', message: `history.sqlite (${formatBytes(size)})` };
  } catch (e) {
    return {
      id: 'db',
      status: 'fail',
      message: `stat failed: ${(e as Error).message}`,
    };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function checkRecentEvents(stateRoot: string, recentWindowMs: number): Promise<DoctorCheck> {
  const daemon = readDaemonJson(stateRoot);
  if (!daemon?.port) {
    return {
      id: 'events',
      status: 'warn',
      message: 'daemon not running — cannot check recent activity',
    };
  }
  // Use /api/sessions ordered by most recent started_at as a proxy for
  // "last event" time. Cheap query already cached by the UI poller.
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 1000);
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/sessions`, {
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        id: 'events',
        status: 'warn',
        message: `/api/sessions returned ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      sessions?: Array<{ started_at?: number; ended_at?: number }>;
    };
    const latest = (data.sessions ?? [])
      .map((s) => Math.max(s.started_at ?? 0, s.ended_at ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    if (latest === 0) {
      return {
        id: 'events',
        status: 'warn',
        message: 'no sessions captured yet',
        fix: 'start a chat in Claude Code / OpenCode / Codex',
      };
    }
    const ageMs = Date.now() - latest;
    if (ageMs <= recentWindowMs) {
      return { id: 'events', status: 'ok', message: `last event ${formatAge(ageMs)} ago` };
    }
    return {
      id: 'events',
      status: 'warn',
      message: `last event ${formatAge(ageMs)} ago (stale)`,
      fix: 'confirm the agent is running and its hook is wired up',
    };
  } catch (err) {
    return {
      id: 'events',
      status: 'warn',
      message: `fetch failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(to);
  }
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

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const stateRoot = options.stateRoot ?? getStateDir();
  const settingsPath = options.settingsPath ?? defaultClaudeSettings();
  const pluginPath = options.opencodePluginPath ?? defaultOpenCodePlugin();
  const cwd = options.cwd ?? process.cwd();
  const recentMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;

  const checks: DoctorCheck[] = [
    checkNode(),
    checkStateDir(stateRoot),
    await checkDaemon(stateRoot),
    checkClaudeHook(settingsPath),
    checkOpenCodePlugin(pluginPath),
    checkPostCommit(cwd),
    checkDatabase(stateRoot),
    await checkRecentEvents(stateRoot, recentMs),
  ];

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
  return { checks, summary };
}

// Plain text (no ANSI colors so it's grep-friendly and renders the same in
// every terminal). Each check is one line:  <sigil> <id>: <message>
//                                             indented fix hint below.
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const c of report.checks) {
    const sigil = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    lines.push(`${sigil} ${c.id}: ${c.message}`);
    if (c.fix) lines.push(`    fix: ${c.fix}`);
  }
  lines.push('');
  const s = report.summary;
  lines.push(`summary: ${s.ok} ok · ${s.warn} warn · ${s.fail} fail`);
  return `${lines.join('\n')}\n`;
}
