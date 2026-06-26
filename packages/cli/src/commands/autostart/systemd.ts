import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type AutostartContext, type AutostartPlan, systemdUnitPath } from './index.js';

// Linux autostart backend (primary): a `systemd --user` unit. User units
// run as the logged-in user, start at the beginning of the user session,
// and disappear at session end — which is exactly the lifecycle we want
// for a developer tool that should outlive `minspect init`'s shell but
// not the user's login. `Restart=on-failure` mirrors the launchd
// SuccessfulExit=false contract: a graceful `minspect stop` (exit 0) is
// not respawned; only crashes come back.

function buildUnit(ctx: AutostartContext): string {
  // `Type=simple` (the default) is correct here: the daemon is a long-
  // running process that doesn't fork and writes its state.json. We do
  // NOT use `Type=notify` because that would require the daemon to talk
  // sd_notify, which is out of scope. `RestartSec=5` prevents tight
  // restart loops if startup is broken.
  return `[Unit]
Description=minspect local collector daemon
Documentation=https://github.com/ivenlau/minspect
After=network.target

[Service]
Type=simple
ExecStart=${ctx.paths.nodePath} ${ctx.paths.minspectBinPath} serve --quiet
Restart=on-failure
RestartSec=5
WorkingDirectory=${process.env.HOME ?? ''}

[Install]
WantedBy=default.target
`;
}

export function planSystemd(ctx: AutostartContext): AutostartPlan {
  const unitPath = systemdUnitPath();
  return {
    backend: 'systemd',
    unitPath,
    unitBody: buildUnit(ctx),
    // `--user` keeps the unit out of /etc and out of root's reach. The
    // daemon is scoped to the user's session, no admin needed.
    enable: {
      cmd: 'systemctl',
      args: ['--user', 'enable', '--now', unitPath],
    },
    disable: {
      cmd: 'systemctl',
      args: ['--user', 'disable', '--now', unitPath],
    },
    isInstalled: () => existsSync(unitPath),
  };
}

export function executeSystemd(plan: AutostartPlan): void {
  mkdirSync(dirname(plan.unitPath), { recursive: true });
  writeFileSync(plan.unitPath, plan.unitBody);
  // We intentionally do NOT `daemon-reload` between writes — `enable`
  // notices the new unit file on its own. A reload would race with
  // freshly-started units in the same session and is unnecessary.
  execFileSync(plan.enable.cmd, plan.enable.args, { stdio: 'ignore' });
}

export function removeSystemd(plan: AutostartPlan): void {
  try {
    execFileSync(plan.disable.cmd, plan.disable.args, { stdio: 'ignore' });
  } catch {
    // disable fails when the unit isn't enabled — fine, we still want
    // to delete the file.
  }
  if (existsSync(plan.unitPath)) unlinkSync(plan.unitPath);
}
