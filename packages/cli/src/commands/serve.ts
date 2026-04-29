import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type SpawnedBy,
  Store,
  getDbPath,
  getStateDir,
  startServer,
  writeState,
} from '@minspect/collector';
import { getStateFilePath } from '../paths.js';

// Resolve @minspect/collector's compiled entry by path. `require.resolve`
// trips over the pkg's `exports` field in some vitest runs, so we compute it
// from this file's location (dist/commands/serve.js → ../../../collector/dist/index.js).
function resolveCollectorEntry(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // CLI dist layout: packages/cli/dist/commands/serve.js
    // Collector:      packages/collector/dist/index.js
    const candidates = [
      resolve(here, '..', '..', '..', 'collector', 'dist', 'index.js'),
      resolve(here, '..', '..', '..', '..', 'collector', 'dist', 'index.js'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  } catch {
    return null;
  }
}
const COLLECTOR_ENTRY = resolveCollectorEntry();

export interface ServeOptions {
  // Undefined = default 21477 with fallback to 21478..21486.
  // 0 = let the OS pick a random free port (tests use this for isolation).
  // Any other number = pin exactly; fail if busy.
  port?: number;
  noOpen?: boolean;
  stateRoot?: string;
  // When true, suppress the "minspect listening" banner and don't open the
  // browser. Used when another process (a hook auto-spawn, card 43) starts
  // the daemon — we want minimal terminal noise in that case.
  quiet?: boolean;
}

// Stable default port. The UI stores language/theme/dashboard-range in
// localStorage keyed by origin, so a fixed port lets users keep bookmarks
// and lose no state across restarts. If it's occupied we shift by 1 up to
// DEFAULT_PORT_FALLBACK_MAX — the common case is that the previous daemon
// shut down cleanly and 21477 is free.
export const DEFAULT_PORT = 21477;
const DEFAULT_PORT_FALLBACK_MAX = 21486;

// Start the server honoring ServeOptions.port semantics. Only the default
// path (port undefined) walks the fallback range; any explicit port — pinned
// or OS-random (0) — passes straight through so misconfiguration surfaces
// instead of silently landing somewhere else.
async function startServerWithFallback(
  store: Store,
  requestedPort: number | undefined,
): Promise<{ port: number; stop: () => Promise<void> }> {
  if (requestedPort !== undefined) {
    return startServer({ store, port: requestedPort });
  }
  let lastErr: unknown = null;
  for (let p = DEFAULT_PORT; p <= DEFAULT_PORT_FALLBACK_MAX; p++) {
    try {
      const srv = await startServer({ store, port: p });
      if (p !== DEFAULT_PORT) {
        process.stdout.write(`defaulted to ${p} because ${DEFAULT_PORT} was busy\n`);
      }
      return srv;
    } catch (err) {
      lastErr = err;
      if (!isAddrInUse(err)) throw err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `could not bind any port in [${DEFAULT_PORT}, ${DEFAULT_PORT_FALLBACK_MAX}]: ${msg}`,
  );
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err) && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

// `MINSPECT_SPAWNED_BY` is set by internal spawners (the hook auto-spawn in
// transport.ts, or `minspect init` in card 44). Any other invocation is the
// user running `minspect serve` by hand.
function resolveSpawnedBy(): SpawnedBy {
  const v = process.env.MINSPECT_SPAWNED_BY;
  if (v === 'hook' || v === 'init') return v;
  return 'user';
}

async function probeHealth(port: number, timeoutMs = 500): Promise<boolean> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

interface RunningDaemon {
  port: number;
  pid: number;
}

async function findRunningDaemon(stateRoot?: string): Promise<RunningDaemon | null> {
  const path = getStateFilePath(stateRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = await import('node:fs').then((m) => m.readFileSync(path, 'utf8'));
    const state = JSON.parse(raw) as { port?: number; pid?: number };
    if (!state.port || !state.pid) return null;
    // Check PID alive (kill 0 throws if dead)
    try {
      process.kill(state.pid, 0);
    } catch {
      return null;
    }
    // Check health
    const healthy = await probeHealth(state.port);
    if (!healthy) return null;
    return { port: state.port, pid: state.pid };
  } catch {
    return null;
  }
}

interface DaemonBuildInfo {
  ui_hash: string;
  server_started_at: number;
  server_code_mtime: number;
}

// Fetch the daemon's self-reported build info. Used to decide whether a
// running daemon is still on the same code revision as the current shell.
async function probeBuildInfo(port: number, timeoutMs = 500): Promise<DaemonBuildInfo | null> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/build-info`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as DaemonBuildInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// True if the daemon is running code older than what's currently on disk
// (user rebuilt after the daemon started). Returns false if we can't find
// the collector's compiled entry — prefer false negatives over false
// alarms here.
function isDaemonStale(info: DaemonBuildInfo | null): boolean {
  if (!info || !COLLECTOR_ENTRY) return false;
  try {
    const diskMtime = statSync(COLLECTOR_ENTRY).mtimeMs;
    // 1 s tolerance for filesystem timestamp granularity.
    return diskMtime > info.server_code_mtime + 1000;
  } catch {
    return false;
  }
}

export interface ServeHandle {
  port: number;
  reused: boolean;
  stop: () => Promise<void>; // graceful stop (tests); production uses SIGINT
}

export async function runServe(options: ServeOptions = {}): Promise<ServeHandle> {
  const existing = await findRunningDaemon(options.stateRoot);
  if (existing) {
    // Strict reuse: refuse to share a daemon whose code on disk has been
    // rebuilt since it started. Common case: user ran `pnpm -r build` and
    // reinvokes `serve` expecting the new code to land. Without this check
    // we silently reuse the stale daemon and every subsequent request hits
    // old handlers.
    const info = await probeBuildInfo(existing.port);
    const stale = isDaemonStale(info);
    if (!stale) {
      if (!options.noOpen) void openBrowser(`http://127.0.0.1:${existing.port}`);
      process.stdout.write(
        `reused daemon on http://127.0.0.1:${existing.port} (pid ${existing.pid})\n`,
      );
      return {
        port: existing.port,
        reused: true,
        stop: async () => {
          /* not ours */
        },
      };
    }
    process.stdout.write(
      `daemon on port ${existing.port} is running stale code (rebuilt after it started); restarting...\n`,
    );
    if (existing.pid !== process.pid) {
      try {
        process.kill(existing.pid);
      } catch {
        /* already gone */
      }
    }
    try {
      unlinkSync(getStateFilePath(options.stateRoot));
    } catch {
      /* ignore */
    }
    // Small pause so the OS releases the old port before we bind.
    await new Promise((r) => setTimeout(r, 200));
  }

  const stateRoot = options.stateRoot ?? getStateDir();
  mkdirSync(stateRoot, { recursive: true });
  const store = new Store(getDbPath(stateRoot));
  const srv = await startServerWithFallback(store, options.port);
  const spawnedBy = resolveSpawnedBy();
  writeState(
    { port: srv.port, pid: process.pid, started_at: Date.now(), spawned_by: spawnedBy },
    stateRoot,
  );
  if (!options.quiet) {
    process.stdout.write(`minspect listening on http://127.0.0.1:${srv.port}\n`);
  }
  const shouldOpen = !options.noOpen && !options.quiet;
  if (shouldOpen) void openBrowser(`http://127.0.0.1:${srv.port}`);

  const cleanup = async () => {
    try {
      await srv.stop();
    } catch {
      // ignore
    }
    try {
      unlinkSync(getStateFilePath(stateRoot));
    } catch {
      // ignore
    }
    try {
      store.close();
    } catch {
      // ignore
    }
  };

  // Foreground mode: clean shutdown on SIGINT/SIGTERM.
  const onSignal = async () => {
    await cleanup();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return { port: srv.port, reused: false, stop: cleanup };
}

export async function runStop(options: { stateRoot?: string } = {}): Promise<boolean> {
  const daemon = await findRunningDaemon(options.stateRoot);
  if (!daemon) {
    // Nothing running; clean stale state file if any.
    try {
      unlinkSync(getStateFilePath(options.stateRoot));
    } catch {
      // ignore
    }
    return false;
  }
  // Refuse to kill our own PID (tests spawn the server inline; self-kill
  // would terminate the test runner). Production `minspect stop` runs from
  // a fresh process so this is a no-op path.
  if (daemon.pid !== process.pid) {
    try {
      process.kill(daemon.pid);
    } catch {
      // ignore
    }
  }
  try {
    unlinkSync(getStateFilePath(options.stateRoot));
  } catch {
    // ignore
  }
  return true;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // best-effort; user can visit manually
  }
}
