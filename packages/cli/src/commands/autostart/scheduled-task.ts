import { execFileSync } from 'node:child_process';
import type { AutostartContext, AutostartPlan } from './index.js';

// Windows autostart backend: a per-user Run-key entry under
// HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
//
// We previously tried Task Scheduler (`schtasks /Create /SC ONLOGON`)
// but creating an ONLOGON task from a non-elevated shell returns
// "Access is denied" — ONLOGON triggers need admin to wire up the
// session-attached token. The HKCU Run key, by contrast, is plain
// per-user state that any interactive user can write, and Explorer
// launches it at logon (same UX as ONLOGON for our headless daemon).
//
// The command line is stored as a single REG_SZ string with the node
// bin + minspect bin + `serve --quiet` arguments. Registry value
// parsing uses the same CommandLineToArgvW rules as a normal Win32
// process invocation, so paths with spaces work as long as the inner
// double quotes are intact. We escape any inner quotes by doubling
// them (`"` → `\"`) per the reg.exe convention.

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'minspect-daemon';

// reg.exe interprets embedded `"` characters as REG_SZ delimiters, so
// paths that contain quotes must escape them as `\"`. Real-world node
// install paths and npm bin paths don't contain quotes today, but
// forwarding the same convention makes the function robust.
function escapeReg(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildCommand(ctx: AutostartContext): string {
  const { nodePath, minspectBinPath } = ctx.paths;
  return `"${escapeReg(nodePath)}" "${escapeReg(minspectBinPath)}" serve --quiet`;
}

export function planScheduledTask(ctx: AutostartContext): AutostartPlan {
  const command = buildCommand(ctx);
  return {
    backend: 'scheduled-task',
    // The "unit path" is the registry value, not a file path; we keep
    // the same path-like string convention so status / doctor can
    // render it without platform special-casing.
    unitPath: `${RUN_KEY}\\${RUN_VALUE}`,
    unitBody: command,
    enable: {
      cmd: 'reg',
      args: ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', command, '/f'],
    },
    disable: {
      cmd: 'reg',
      args: ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'],
    },
    isInstalled: () => {
      try {
        execFileSync('reg', ['query', RUN_KEY, '/v', RUN_VALUE], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function executeScheduledTask(plan: AutostartPlan, _ctx: AutostartContext): void {
  // reg.exe returns exit 0 on successful add, even when the value
  // already exists (because of /f). stderr is intentionally ignored
  // — reg.exe prints "The operation completed successfully." on stdout
  // and we'd rather not leak that into CLI output.
  execFileSync(plan.enable.cmd, plan.enable.args, { stdio: 'ignore' });
}

export function removeScheduledTask(plan: AutostartPlan): void {
  try {
    execFileSync(plan.disable.cmd, plan.disable.args, { stdio: 'ignore' });
  } catch {
    /* not installed */
  }
}

// Exported for unit tests. Not part of the public surface — install-autostart
// goes through planScheduledTask, never these helpers directly.
export const __testing__ = { escapeReg, buildCommand };
