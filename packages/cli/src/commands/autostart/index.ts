import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { platform } from 'node:os';

// OS-level autostart backends, one per supported platform. Each backend is
// user-space (no sudo / admin required) and survives across reboots by
// piggy-backing on the OS's own login-session mechanism: launchd on macOS,
// systemd --user (with a freedesktop-autostart fallback) on Linux, Task
// Scheduler on Windows. See `docs/specs/cli.md` for the rationale and the
// "autostart" canonical rules.

export type AutostartBackend =
  | 'launchd' // macOS: ~/Library/LaunchAgents/com.ivenlau.minspect.plist
  | 'systemd' // Linux: ~/.config/systemd/user/minspect.service
  | 'xdg-autostart' // Linux fallback: ~/.config/autostart/minspect.desktop
  | 'scheduled-task' // Windows: Task Scheduler "minspect daemon" (ONLOGON)
  | 'unsupported'; // catch-all for future / unknown platforms

// What the autostart file should invoke. The install path for the CLI is
// captured at install time so the unit file never depends on PATH — the
// current process's `argv[1]` is the same JS entry the user just ran, and
// `process.execPath` is the matching node binary. Both survive npm upgrades
// because the user re-runs `install-autostart` (or `init`) when they bump.
export interface AutostartPaths {
  nodePath: string;
  minspectBinPath: string;
}

export interface AutostartContext {
  stateRoot: string;
  paths: AutostartPaths;
  // Used by the macOS plist for log redirection. The directory must already
  // exist (or the platform-specific plan() is responsible for creating it).
  logDir?: string;
}

// A platform backend's planned install: where the unit file would land,
// what its body would be, and the OS command(s) needed to enable + start it.
// `enable` is the command the executor runs after writing the file; the
// planner itself never spawns anything.
export interface AutostartPlan {
  backend: AutostartBackend;
  unitPath: string;
  unitBody: string;
  enable: { cmd: string; args: string[] };
  disable: { cmd: string; args: string[] };
  // Whether the unit is currently present on disk. Used by uninstall to
  // decide between "remove and disable" vs "nothing to do".
  isInstalled: () => boolean;
}

// Best-effort lookup for a node binary on PATH. Returns null on miss.
// `process.execPath` is the *current* node, which is always valid for the
// running CLI but may not match what `which node` reports (e.g. nvm users
// with a different default). Callers should prefer `process.execPath` and
// fall back to this.
function whichNode(): string | null {
  const cmd = platform() === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(cmd, ['node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

// Resolve the absolute path to a node binary suitable for the autostart
// unit. Order: `process.execPath` (we know it works) → PATH lookup → null.
export function resolveNodePath(): string | null {
  if (process.execPath) return process.execPath;
  return whichNode();
}

// Resolve the absolute path to the CLI's bin.js entry. The `argv[1]` of the
// currently running process IS that file (after symlink resolution), so it
// is the most reliable signal. Falls back to `which minspect` for installs
// that wrap the entry in a launcher.
export function resolveMinspectBinPath(): string | null {
  const argv1 = process.argv[1];
  if (argv1 && argv1.length > 0) return argv1;
  try {
    const out = execFileSync('which', ['minspect'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

// Look up a binary by name. Returns absolute path or null. Used by the
// platform backends to verify `systemctl` is around (Linux) or to resolve
// `schtasks` (Windows) — those are the OS-side tools we shell out to.
function whichTool(name: string): string | null {
  const cmd = platform() === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(cmd, [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

// Check whether `systemctl --user` is available and functional. We treat
// the absence of either the binary or the user session bus as "not
// available", in which case the index falls back to XDG autostart. The
// `show-environment` subcommand is the recommended way to probe the
// user bus without side effects — it just dumps variables and exits 0
// when the bus is reachable.
export function hasSystemdUser(): boolean {
  if (platform() !== 'linux') return false;
  if (!whichTool('systemctl')) return false;
  try {
    execFileSync('systemctl', ['--user', 'show-environment'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

// Path helpers shared across backends. Centralized so tests can verify
// the exact location a given context resolves to without mocking each
// platform file individually.

export function launchdPlistPath(): string {
  const home = process.env.HOME ?? homedir();
  return `${home}/Library/LaunchAgents/com.ivenlau.minspect.plist`;
}

export function launchdLogDir(): string {
  const home = process.env.HOME ?? homedir();
  return `${home}/Library/Logs/minspect`;
}

export function systemdUnitPath(): string {
  const home = process.env.HOME ?? homedir();
  // $XDG_CONFIG_HOME defaults to ~/.config per the freedesktop spec.
  const xdg = process.env.XDG_CONFIG_HOME ?? `${home}/.config`;
  return `${xdg}/systemd/user/minspect.service`;
}

export function xdgAutostartDesktopPath(): string {
  const home = process.env.HOME ?? homedir();
  const xdg = process.env.XDG_CONFIG_HOME ?? `${home}/.config`;
  return `${xdg}/autostart/minspect.desktop`;
}

export function scheduledTaskName(): string {
  return 'minspect daemon';
}

// Re-export platform-specific planners so `install-autostart.ts` can pick
// the right one without importing from inside the autostart/ subtree.
export { planLaunchd, executeLaunchd } from './launchd.js';
export { planSystemd, executeSystemd } from './systemd.js';
export { planXdgAutostart, executeXdgAutostart } from './xdg-autostart.js';
export { planScheduledTask, executeScheduledTask } from './scheduled-task.js';
