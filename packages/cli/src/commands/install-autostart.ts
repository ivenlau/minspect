import { execFileSync } from 'node:child_process';
import { readConfig, writeConfig } from '../config.js';
import {
  type AutostartBackend,
  type AutostartContext,
  type AutostartPaths,
  type AutostartPlan,
  hasSystemdUser,
  planLaunchd,
  planScheduledTask,
  planSystemd,
  planXdgAutostart,
  resolveMinspectBinPath,
  resolveNodePath,
} from './autostart/index.js';
import { executeLaunchd, removeLaunchd } from './autostart/launchd.js';
import { executeScheduledTask, removeScheduledTask } from './autostart/scheduled-task.js';
import { executeSystemd, removeSystemd } from './autostart/systemd.js';
import { executeXdgAutostart, removeXdgAutostart } from './autostart/xdg-autostart.js';

// One-shot registration of the minspect daemon as a per-user login item.
// Symmetric with `uninstall-autostart` and integrated into `init`. The
// actual unit-file generation lives in autostart/<backend>.ts; this
// orchestrator picks the backend, builds a plan, and runs it.

export interface InstallAutostartOptions {
  stateRoot?: string;
  // Test seams: callers (tests, custom installs) can inject the absolute
  // paths to avoid `which` calls. Real CLI invocations let the resolver
  // pick them up.
  nodePath?: string;
  minspectBinPath?: string;
  // Force a specific backend. Default: pick from `process.platform`,
  // with a Linux systemd → xdg-autostart downgrade.
  backend?: AutostartBackend;
  // Persist the choice to <state_dir>/config.json. Default true; the
  // dedicated subcommand does this, the implicit `init` step can opt out
  // to control sequencing separately.
  persist?: boolean;
  // Skip the side-effecting `enable` call (writes the unit file but does
  // NOT register it with the OS). Used by `init` to do the "show me
  // what would happen" path during interactive prompts.
  dryRun?: boolean;
}

export interface InstallAutostartResult {
  backend: AutostartBackend;
  unitPath: string;
  enabled: boolean;
  started: boolean;
  detail: string;
  // What would have happened if dryRun were false. Always populated so
  // the caller can print a concrete next-step.
  enableCommand?: { cmd: string; args: string[] };
}

interface ResolvedBackend {
  backend: AutostartBackend;
  plan: AutostartPlan;
  execute: (plan: AutostartPlan, ctx: AutostartContext) => void;
}

function resolveBackend(
  requested: AutostartBackend | undefined,
  ctx: AutostartContext,
): ResolvedBackend {
  // Explicit `unsupported` from caller: pass through.
  if (requested === 'unsupported') {
    throw new Error('autostart is not supported on this platform');
  }
  if (requested) {
    switch (requested) {
      case 'launchd':
        return {
          backend: 'launchd',
          plan: planLaunchd(ctx),
          execute: (p, c) => executeLaunchd(p, c),
        };
      case 'systemd':
        return {
          backend: 'systemd',
          plan: planSystemd(ctx),
          execute: (p) => executeSystemd(p),
        };
      case 'xdg-autostart':
        return {
          backend: 'xdg-autostart',
          plan: planXdgAutostart(ctx),
          execute: (p) => executeXdgAutostart(p),
        };
      case 'scheduled-task':
        return {
          backend: 'scheduled-task',
          plan: planScheduledTask(ctx),
          execute: (p) => executeScheduledTask(p),
        };
    }
  }
  // Default: pick by platform. Linux gets the systemd→xdg downgrade;
  // macOS/Windows always go to their native backend.
  switch (process.platform) {
    case 'darwin':
      return {
        backend: 'launchd',
        plan: planLaunchd(ctx),
        execute: (p, c) => executeLaunchd(p, c),
      };
    case 'linux':
      if (hasSystemdUser()) {
        return {
          backend: 'systemd',
          plan: planSystemd(ctx),
          execute: (p) => executeSystemd(p),
        };
      }
      return {
        backend: 'xdg-autostart',
        plan: planXdgAutostart(ctx),
        execute: (p) => executeXdgAutostart(p),
      };
    case 'win32':
      return {
        backend: 'scheduled-task',
        plan: planScheduledTask(ctx),
        execute: (p) => executeScheduledTask(p),
      };
    default:
      throw new Error(
        `autostart is not supported on platform: ${process.platform}. Run \`minspect serve\` manually instead.`,
      );
  }
}

function resolvePaths(opts: InstallAutostartOptions): AutostartPaths {
  const nodePath = opts.nodePath ?? resolveNodePath();
  const minspectBinPath = opts.minspectBinPath ?? resolveMinspectBinPath();
  if (!nodePath) {
    throw new Error(
      'could not resolve node binary. Set --node-path or install Node.js so `node` is on PATH.',
    );
  }
  if (!minspectBinPath) {
    throw new Error('could not resolve minspect bin path. Set --minspect-bin-path explicitly.');
  }
  return { nodePath, minspectBinPath };
}

export function runInstallAutostart(options: InstallAutostartOptions = {}): InstallAutostartResult {
  const paths = resolvePaths(options);
  const stateRoot = options.stateRoot ?? '';
  const ctx: AutostartContext = { stateRoot, paths };

  const { backend, plan, execute } = resolveBackend(options.backend, ctx);

  if (options.dryRun) {
    return {
      backend,
      unitPath: plan.unitPath,
      enabled: false,
      started: false,
      detail: `would write ${plan.unitPath} and run: ${plan.enable.cmd} ${plan.enable.args.join(' ')}`,
      enableCommand: plan.enable,
    };
  }

  // Side-effecting: write unit + register with OS. Both `execute*` and
  // `remove*` swallow their own errors for the disable path (used at
  // uninstall), so a missing service there is non-fatal.
  execute(plan, ctx);

  // Persist preference. Default-on for the dedicated subcommand;
  // `init` may pass persist:false to keep its own bookkeeping consistent
  // (it already calls writeConfig elsewhere in its flow).
  if (options.persist !== false) {
    const cfg = readConfig(options.stateRoot);
    writeConfig({ ...cfg, autostart: true }, options.stateRoot);
  }

  // Probe the OS to confirm the unit actually came up. macOS
  // `launchctl print` and Linux `systemctl is-active` are quick
  // non-fatal probes — we report, but don't fail, on miss. The user
  // can re-check with `minspect status` / `minspect doctor`.
  let started = false;
  try {
    if (backend === 'launchd') {
      const out = execFileSync('launchctl', ['list'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      started = out.includes('com.ivenlau.minspect');
    } else if (backend === 'systemd') {
      execFileSync('systemctl', ['--user', 'is-active', 'minspect.service'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      started = true;
    } else if (backend === 'scheduled-task') {
      execFileSync('schtasks', ['/Query', '/TN', 'minspect daemon'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      started = true;
    }
    // xdg-autostart: the .desktop file is registered by being present;
    // there is no OS-level "is running" query for autostart entries.
    // We treat it as "enabled" and let the user verify with status.
  } catch {
    started = false;
  }

  return {
    backend,
    unitPath: plan.unitPath,
    enabled: true,
    started,
    detail: `${backend} registered at ${plan.unitPath}`,
  };
}

// Exposed for `uninstall-autostart.ts`. Picks the matching backend and
// runs the per-platform remove (disable + unlink). Plan and execute are
// separate (mirroring `uninstall.ts`'s `planX` / `executeX` split) so
// dry-run reports are free of side effects.
export function planUninstallAutostart(options: InstallAutostartOptions = {}): {
  backend: AutostartBackend;
  unitPath: string;
  wasInstalled: boolean;
  detail: string;
} {
  const paths = resolvePaths(options);
  const stateRoot = options.stateRoot ?? '';
  const ctx: AutostartContext = { stateRoot, paths };

  const { backend, plan, execute } = resolveBackend(options.backend, ctx);
  // Unused in the plan path; we just want plan.unitPath / isInstalled.
  void execute;

  const wasInstalled = plan.isInstalled();
  return {
    backend,
    unitPath: plan.unitPath,
    wasInstalled,
    detail: wasInstalled
      ? `${backend} is registered at ${plan.unitPath}`
      : `${backend} is not registered`,
  };
}

export function executeUninstallAutostart(options: InstallAutostartOptions = {}): {
  backend: AutostartBackend;
  unitPath: string;
  removed: boolean;
  detail: string;
} {
  const paths = resolvePaths(options);
  const stateRoot = options.stateRoot ?? '';
  const ctx: AutostartContext = { stateRoot, paths };

  const { backend, plan, execute } = resolveBackend(options.backend, ctx);
  // Unused on the remove path; remove* calls are what matter.
  void execute;

  const wasInstalled = plan.isInstalled();
  if (backend === 'launchd') removeLaunchd(plan);
  else if (backend === 'systemd') removeSystemd(plan);
  else if (backend === 'xdg-autostart') removeXdgAutostart(plan);
  else if (backend === 'scheduled-task') removeScheduledTask(plan);

  if (options.persist !== false) {
    const cfg = readConfig(options.stateRoot);
    writeConfig({ ...cfg, autostart: false }, options.stateRoot);
  }

  return {
    backend,
    unitPath: plan.unitPath,
    removed: wasInstalled,
    detail: wasInstalled
      ? `${backend} removed from ${plan.unitPath}`
      : `${backend} was not installed`,
  };
}
