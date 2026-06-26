import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type AutostartContext, type AutostartPlan, xdgAutostartDesktopPath } from './index.js';

// Linux autostart backend (fallback): freedesktop autostart .desktop
// file. Activated by GNOME / KDE / XFCE / LXQt / Cinnamon the moment
// the user logs into a graphical session — same end result as a
// `systemd --user` unit for desktop users, with the only difference
// being the daemon's parent process. We use this only when `systemctl
// --user` is unavailable (containers, WSL, Alpine, etc).

function buildDesktop(ctx: AutostartContext): string {
  // `Exec=` runs the daemon with the same arguments the user would
  // type. We pass the absolute paths so the autostart entry does not
  // depend on the desktop session's PATH (which can differ from the
  // shell's, e.g. minimal GNOME sessions strip /usr/local/bin).
  // `Terminal=false` prevents a terminal window from popping up; the
  // UI is in the browser, not in stdout.
  return `[Desktop Entry]
Type=Application
Name=minspect daemon
Comment=minspect local collector daemon
Exec=${ctx.paths.nodePath} ${ctx.paths.minspectBinPath} serve --quiet
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

export function planXdgAutostart(ctx: AutostartContext): AutostartPlan {
  const unitPath = xdgAutostartDesktopPath();
  return {
    backend: 'xdg-autostart',
    unitPath,
    unitBody: buildDesktop(ctx),
    // The .desktop file is "enabled" by simply being present in
    // ~/.config/autostart/. The X-GNOME-Autostart-enabled key is the
    // gnome-specific override; we leave it on for safety. Some DEs
    // honor `Hidden=false` (default) so no extra step is required.
    enable: {
      cmd: '/bin/true',
      args: [],
    },
    disable: {
      cmd: '/bin/true',
      args: [],
    },
    isInstalled: () => existsSync(unitPath),
  };
}

export function executeXdgAutostart(plan: AutostartPlan): void {
  mkdirSync(dirname(plan.unitPath), { recursive: true });
  writeFileSync(plan.unitPath, plan.unitBody);
  // Mark executable: file managers and some autostart launchers key off
  // the bit. systemd-less desktops vary on this; chmod 0o755 matches
  // what the freedesktop spec example shows. Wrapped in try/catch so
  // non-Linux test environments (where this file is still type-checked)
  // don't blow up if chmod ever returns ENOENT in odd setups.
  try {
    chmodSync(plan.unitPath, 0o755);
  } catch {
    /* chmod may fail on non-POSIX filesystems; not fatal */
  }
}

export function removeXdgAutostart(plan: AutostartPlan): void {
  if (existsSync(plan.unitPath)) unlinkSync(plan.unitPath);
}
