import { readConfig, writeConfig } from '../config.js';
import { executeUninstallAutostart, planUninstallAutostart } from './install-autostart.js';

// Symmetric counterpart of `install-autostart`. Follows the same
// plan/execute pattern as `uninstall.ts` (cards 41): default dry-run
// prints the would-be plan; `--yes` actually does it. Hooked into
// `uninstall --all` so the orchestrator doesn't have to know about
// platform specifics.

export interface UninstallAutostartOptions {
  // Mirrors the install side: tests can inject the absolute paths.
  nodePath?: string;
  minspectBinPath?: string;
  backend?: 'launchd' | 'systemd' | 'xdg-autostart' | 'scheduled-task' | 'unsupported' | 'auto';
  // Persist `autostart: false` to config. Default true.
  persist?: boolean;
  // Default false (dry-run). Pass true to apply.
  yes?: boolean;
  stateRoot?: string;
}

export interface UninstallAutostartStep {
  backend: string;
  unitPath: string;
  detail: string;
  // Populated when --yes; undefined for dry-run.
  result?: 'removed' | 'skipped' | 'failed';
  error?: string;
}

export interface UninstallAutostartResult {
  dryRun: boolean;
  steps: UninstallAutostartStep[];
}

export function planUninstallAutostartSteps(
  options: UninstallAutostartOptions = {},
): UninstallAutostartStep[] {
  // Pre-flight only. We may be on an unsupported platform, in which
  // case the install-side helper throws — translate that to a single
  // "skipped" step so the dry-run report still tells the user
  // something useful. The live path catches the same exception in
  // `runUninstallAutostart` and treats it as no-op.
  try {
    const r = planUninstallAutostart({
      stateRoot: options.stateRoot,
      nodePath: options.nodePath,
      minspectBinPath: options.minspectBinPath,
      backend:
        options.backend === 'auto' || options.backend === undefined
          ? undefined
          : (options.backend as
              | 'launchd'
              | 'systemd'
              | 'xdg-autostart'
              | 'scheduled-task'
              | 'unsupported'),
      persist: options.persist,
    });
    return [
      {
        backend: r.backend,
        unitPath: r.unitPath,
        detail: r.wasInstalled ? `would remove (${r.detail})` : 'would skip (not installed)',
      },
    ];
  } catch (e) {
    return [
      {
        backend: options.backend ?? 'auto',
        unitPath: '',
        detail: (e as Error).message,
        result: 'skipped',
      },
    ];
  }
}

export function runUninstallAutostart(
  options: UninstallAutostartOptions = {},
): UninstallAutostartResult {
  const dryRun = options.yes !== true;
  const steps: UninstallAutostartStep[] = [];

  if (dryRun) {
    return { dryRun: true, steps: planUninstallAutostartSteps(options) };
  }

  try {
    const r = executeUninstallAutostart({
      stateRoot: options.stateRoot,
      nodePath: options.nodePath,
      minspectBinPath: options.minspectBinPath,
      backend:
        options.backend === 'auto' || options.backend === undefined
          ? undefined
          : (options.backend as
              | 'launchd'
              | 'systemd'
              | 'xdg-autostart'
              | 'scheduled-task'
              | 'unsupported'),
      persist: options.persist,
    });
    steps.push({
      backend: r.backend,
      unitPath: r.unitPath,
      detail: r.detail,
      result: r.removed ? 'removed' : 'skipped',
    });
  } catch (e) {
    steps.push({
      backend: options.backend ?? 'auto',
      unitPath: '',
      detail: (e as Error).message,
      result: 'skipped',
    });
  }

  // Persist the preference flip. `executeUninstallAutostart` already
  // does this when persist !== false; we re-assert here only as a
  // safety net for the path where the install-side helper threw early.
  const cfg = readConfig(options.stateRoot);
  writeConfig({ ...cfg, autostart: false }, options.stateRoot);

  return { dryRun: false, steps };
}

export function formatUninstallAutostartReport(result: UninstallAutostartResult): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? 'autostart dry-run plan:' : 'autostart uninstall result:');
  for (const s of result.steps) {
    const tag = s.result ? ` [${s.result}]` : '';
    lines.push(`  ${s.backend}: ${s.detail}${tag}`);
    if (s.unitPath) lines.push(`    path: ${s.unitPath}`);
    if (s.error) lines.push(`    error: ${s.error}`);
  }
  if (result.dryRun) {
    lines.push('');
    lines.push('re-run with --yes to apply.');
  }
  return `${lines.join('\n')}\n`;
}
