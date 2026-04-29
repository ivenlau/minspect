import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Shape of the object returned to the UI when /api/refresh fires. Each step
// records outcome + details — we never 5xx the whole request because the UI
// wants to show per-step status (e.g. claude-code installed OK but codex
// import failed because .codex/sessions doesn't exist yet).
export interface RefreshStepResult {
  name: 'install-claude-code' | 'install-opencode' | 'import-codex';
  status: 'ok' | 'error' | 'skipped';
  stdout?: string;
  stderr?: string;
  error?: string;
  // Timings are nice for the UI's "last refreshed at 12:34 · 2.1s" chip.
  duration_ms: number;
}

export interface RefreshResult {
  ok: boolean;
  steps: RefreshStepResult[];
  started_at: number;
  ended_at: number;
}

// Single in-process mutex. The UI button is disabled while this is true and
// /api/refresh returns 409 if you somehow hit it anyway. This also guards
// the hourly codex import — the timer skips if a manual refresh is running.
let refreshRunning = false;
export function isRefreshRunning(): boolean {
  return refreshRunning;
}

// Resolve how to spawn the minspect binary. When the CLI runs the collector
// in-process (via `minspect serve`), `process.argv[1]` is the CLI's bin.js.
// For `.js` we prefix with Node's own execPath; for an installed .cmd / .exe
// shim we run it directly.
function resolveMinspectSpawn(): { cmd: string; prefixArgs: string[] } | null {
  const bin = process.env.MINSPECT_BIN || process.argv[1];
  if (!bin || !existsSync(bin)) return null;
  const lower = bin.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return { cmd: process.execPath, prefixArgs: [bin] };
  }
  return { cmd: bin, prefixArgs: [] };
}

function runSubcommand(
  args: string[],
  timeoutMs: number,
): Promise<{ status: 'ok' | 'error'; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolvePromise) => {
    const r = resolveMinspectSpawn();
    if (!r) {
      resolvePromise({
        status: 'error',
        stdout: '',
        stderr: '',
        error: 'MINSPECT_BIN not resolvable (collector not started via `minspect serve`)',
      });
      return;
    }
    const child = spawn(r.cmd, [...r.prefixArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    const to = setTimeout(() => {
      child.kill();
      resolvePromise({ status: 'error', stdout, stderr, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(to);
      resolvePromise({ status: 'error', stdout, stderr, error: (e as Error).message });
    });
    child.on('close', (code) => {
      clearTimeout(to);
      if (code === 0) resolvePromise({ status: 'ok', stdout, stderr });
      else
        resolvePromise({
          status: 'error',
          stdout,
          stderr,
          error: `exit code ${code}`,
        });
    });
  });
}

async function runOneStep(
  name: RefreshStepResult['name'],
  args: string[],
  timeoutMs: number,
): Promise<RefreshStepResult> {
  const start = Date.now();
  const res = await runSubcommand(args, timeoutMs);
  return {
    name,
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    ...(res.error ? { error: res.error } : {}),
    duration_ms: Date.now() - start,
  };
}

// Run the three agent-sync steps in sequence. Steps are independent — a
// failure in one does not abort the others; the aggregate summary carries
// `ok = all steps succeeded` plus per-step detail.
export async function runRefresh(options: { codexSince?: string } = {}): Promise<RefreshResult> {
  if (refreshRunning) {
    throw new Error('refresh_already_running');
  }
  refreshRunning = true;
  const started_at = Date.now();
  const steps: RefreshStepResult[] = [];
  try {
    steps.push(
      await runOneStep(
        'install-claude-code',
        ['install', '--agent', 'claude-code', '--scope', 'user'],
        10_000,
      ),
    );
    steps.push(
      await runOneStep(
        'install-opencode',
        ['install', '--agent', 'opencode', '--scope', 'user'],
        10_000,
      ),
    );
    steps.push(
      await runOneStep(
        'import-codex',
        ['import-codex', '--all', '--since', options.codexSince ?? '30d'],
        5 * 60_000,
      ),
    );
  } finally {
    refreshRunning = false;
  }
  const ok = steps.every((s) => s.status === 'ok');
  return { ok, steps, started_at, ended_at: Date.now() };
}

// Hourly timer: re-import Codex sessions from the last day. Cheaper than the
// 30-day window the manual refresh uses — the goal here is to catch new
// sessions users created while the UI was closed, not to re-scan history.
// Returns a disposer the caller can use to stop the timer at shutdown.
export function startHourlyCodexImport(): () => void {
  const intervalMs = 60 * 60_000; // 1 hour
  const run = async () => {
    if (refreshRunning) return; // manual refresh in-flight — don't pile up
    try {
      await runOneStep('import-codex', ['import-codex', '--all', '--since', '1d'], 5 * 60_000);
    } catch {
      /* ignore — logged to stderr via the subprocess already */
    }
  };
  const timer = setInterval(run, intervalMs);
  // The first tick shouldn't fire immediately (avoids stepping on the
  // in-process refresh that the UI user just triggered at startup). Setting
  // unref so the interval doesn't keep the process alive on its own.
  timer.unref();
  return () => clearInterval(timer);
}
