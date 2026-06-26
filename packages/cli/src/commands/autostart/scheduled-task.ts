import { execFileSync } from 'node:child_process';
import { type AutostartContext, type AutostartPlan, scheduledTaskName } from './index.js';

// Windows autostart backend: a Task Scheduler task. `ONLOGON` is the
// user-side equivalent of macOS LaunchAgent: it fires when the user
// signs in. `RL LIMITED` runs the task as the logged-in user without
// admin elevation — same per-user contract as the other backends. The
// daemon has no GUI, so we keep the task invisible (no /V verbose, no
// display window).

function buildTrField(ctx: AutostartContext): string {
  // /TR takes a single command line. We embed the full "node bin.js
  // serve --quiet" so the task doesn't depend on PATH or npm shims —
  // both are known to break under Task Scheduler (it runs as a
  // non-interactive session with a sparse PATH). Paths are quoted
  // because they may contain spaces ("C:\Program Files\nodejs\...").
  // Backslashes are kept as-is; schtasks handles them.
  const { nodePath, minspectBinPath } = ctx.paths;
  return `"${nodePath}" "${minspectBinPath}" serve --quiet`;
}

export function planScheduledTask(ctx: AutostartContext): AutostartPlan {
  const taskName = scheduledTaskName();
  return {
    backend: 'scheduled-task',
    unitPath: `\\${taskName}`,
    unitBody: buildTrField(ctx),
    // /F overwrites any pre-existing task with the same name (idempotent
    // install). /IT ensures the task runs in the user's interactive
    // session — without /IT, ONLOGON tasks run in a non-interactive
    // session that can't access the user's profile (so `LOCALAPPDATA`
    // resolution breaks).
    enable: {
      cmd: 'schtasks',
      args: [
        '/Create',
        '/TN',
        taskName,
        '/TR',
        buildTrField(ctx),
        '/SC',
        'ONLOGON',
        '/RL',
        'LIMITED',
        '/F',
        '/IT',
      ],
    },
    disable: {
      cmd: 'schtasks',
      args: ['/Delete', '/TN', taskName, '/F'],
    },
    isInstalled: () => {
      // `schtasks /Query` exits non-zero when the task doesn't exist.
      // We swallow the throw and use the exit code to decide.
      try {
        execFileSync('schtasks', ['/Query', '/TN', taskName], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function executeScheduledTask(plan: AutostartPlan): void {
  // schtasks /Create both creates and "enables" the task — there's no
  // separate /Enable. The unit body is irrelevant for Windows; we
  // stashed the /TR string in plan.unitBody for `isInstalled` to
  // re-derive if it ever needs to.
  execFileSync(plan.enable.cmd, plan.enable.args, { stdio: 'ignore' });
}

export function removeScheduledTask(plan: AutostartPlan): void {
  try {
    execFileSync(plan.disable.cmd, plan.disable.args, { stdio: 'ignore' });
  } catch {
    /* not installed */
  }
}
