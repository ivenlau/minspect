import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  type AutostartContext,
  type AutostartPlan,
  launchdLogDir,
  launchdPlistPath,
} from './index.js';

// macOS autostart backend: a per-user LaunchAgent. loginwindow loads the
// plist the first time the user opens a session, so the daemon comes up
// after login without needing `RunAtLoad` per se (we set it anyway as
// belt-and-suspenders). KeepAlive intentionally checks SuccessfulExit
// first so a graceful `minspect stop` doesn't immediately get respawned.

const PLIST_LABEL = 'com.ivenlau.minspect';

function uidString(): string {
  // `id -u` is the simplest cross-shell way to get the numeric uid that
  // `launchctl bootstrap gui/$UID ...` expects. Returns empty on failure,
  // in which case the executor skips `bootstrap` and the user is told to
  // run `launchctl load` manually.
  try {
    return execFileSync('id', ['-u'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function buildPlist(ctx: AutostartContext): string {
  // The plist is a static template with three placeholders: paths and
  // log dir. We escape `<>&"` because the values come from disk paths we
  // just resolved — no user input — so a naive string replace is safe.
  // The doc structure follows Apple's Property List documentation; the
  // most surprising field is KeepAlive.SuccessfulExit=false, which is
  // what makes `minspect stop` (exit 0) stick across login.
  const log = ctx.logDir ?? launchdLogDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ctx.paths.nodePath}</string>
    <string>${ctx.paths.minspectBinPath}</string>
    <string>serve</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <array>
    <string>Aqua</string>
    <string>Background</string>
    <string>LoginWindow</string>
  </array>
  <key>StandardOutPath</key>
  <string>${log}/daemon.out.log</string>
  <key>StandardErrorPath</key>
  <string>${log}/daemon.err.log</string>
  <key>WorkingDirectory</key>
  <string>${process.env.HOME ?? ''}</string>
</dict>
</plist>
`;
}

export function planLaunchd(ctx: AutostartContext): AutostartPlan {
  const unitPath = launchdPlistPath();
  const uid = uidString();
  // `bootstrap` (macOS 10.11+) is the recommended replacement for
  // `launchctl load -w`. We pass the user-domain target so the agent runs
  // inside the user's GUI session, not the system domain.
  const target = uid ? `gui/${uid}` : `gui/${process.env.UID ?? ''}`;
  return {
    backend: 'launchd',
    unitPath,
    unitBody: buildPlist(ctx),
    enable: {
      cmd: 'launchctl',
      args: ['bootstrap', target, unitPath],
    },
    disable: {
      cmd: 'launchctl',
      args: ['bootout', target, unitPath],
    },
    isInstalled: () => existsSync(unitPath),
  };
}

export function executeLaunchd(plan: AutostartPlan, ctx: AutostartContext): void {
  // Log dir must exist before launchd tries to redirect stdout/stderr
  // into it — otherwise the daemon fails to start silently.
  const log = ctx.logDir ?? launchdLogDir();
  mkdirSync(log, { recursive: true });
  mkdirSync(launchdPlistPath().replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(plan.unitPath, plan.unitBody);
  execFileSync(plan.enable.cmd, plan.enable.args, { stdio: 'ignore' });
}

export function removeLaunchd(plan: AutostartPlan): void {
  try {
    execFileSync(plan.disable.cmd, plan.disable.args, { stdio: 'ignore' });
  } catch {
    // bootout fails when the agent isn't loaded — fine on a clean
    // uninstall, we still want to delete the plist.
  }
  if (existsSync(plan.unitPath)) unlinkSync(plan.unitPath);
}
