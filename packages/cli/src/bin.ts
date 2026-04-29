#!/usr/bin/env node
import { Command } from 'commander';
import { runCaptureOpenCode } from './commands/capture-opencode.js';
import { runCapture } from './commands/capture.js';
import { formatDoctorReport, runDoctor } from './commands/doctor.js';
import { runImportCodex, runImportCodexAll } from './commands/import-codex.js';
import { runInit } from './commands/init.js';
import { runInstallOpenCode } from './commands/install-opencode.js';
import { runInstall } from './commands/install.js';
import { runLinkCommit } from './commands/link-commit.js';
import { runRevert } from './commands/revert.js';
import { runServe, runStop } from './commands/serve.js';
import { formatStatusReport, runStatus } from './commands/status.js';
import { type UninstallAgent, formatUninstallReport, runUninstall } from './commands/uninstall.js';
import { runVacuum } from './commands/vacuum.js';

const program = new Command();
program.name('minspect').description('AI coding history CLI').version('0.0.0');

// Default action when called with no subcommand: show status. Users first
// reach for `minspect` without args expecting "is it running, where's the
// UI", not a help page. `--help` / `-h` still reach the help output.
program
  .command('status', { isDefault: true })
  .description('Show daemon status, queue, last event, hook summary')
  .option('--json', 'emit JSON (no color; suitable for scripts)')
  .action(async (opts: { json?: boolean }) => {
    const report = await runStatus();
    if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(formatStatusReport(report));
  });

program
  .command('capture')
  .description('Hook entry: read Claude Code payload from stdin, forward to collector')
  .option('--event <name>', 'hook event name (informational; payload drives logic)')
  .action(async () => {
    try {
      await runCapture();
    } catch (err) {
      // Hooks must exit fast. Log and exit 0 so we never block the agent.
      process.stderr.write(`minspect capture: ${(err as Error).message}\n`);
      process.exit(0);
    }
  });

program
  .command('capture-opencode')
  .description('Plugin entry: read OpenCode hook envelope from stdin, forward to collector')
  .action(async () => {
    try {
      await runCaptureOpenCode();
    } catch (err) {
      // Hooks must exit fast. Log and exit 0 so we never block the agent.
      process.stderr.write(`minspect capture-opencode: ${(err as Error).message}\n`);
      process.exit(0);
    }
  });

program
  .command('install')
  .description('Install hook config into an agent (claude-code | opencode)')
  .option('--agent <name>', 'agent name', 'claude-code')
  .option('--scope <scope>', 'user | project', 'user')
  .action((opts: { agent: string; scope: string }) => {
    const scope = opts.scope as 'user' | 'project';
    if (opts.agent === 'opencode') {
      const res = runInstallOpenCode({ scope });
      process.stdout.write(`installed opencode plugin at ${res.path}\n`);
      if (res.backup) process.stdout.write(`  backup: ${res.backup}\n`);
      return;
    }
    const res = runInstall({ agent: opts.agent as 'claude-code', scope });
    process.stdout.write(`installed ${opts.agent} hooks at ${res.path}\n`);
    if (res.backup) {
      process.stdout.write(`  backup: ${res.backup}\n`);
    }
  });

program
  .command('link-commit')
  .description(
    'Associate HEAD commit with recent AI edits (typically called from post-commit hook)',
  )
  .action(async () => {
    try {
      await runLinkCommit();
    } catch (err) {
      process.stderr.write(`minspect link-commit: ${(err as Error).message}\n`);
      process.exit(0);
    }
  });

program
  .command('serve')
  .description('Start the local collector daemon and open the UI in your browser')
  .option('--port <port>', 'port to listen on (default: 21477)')
  .option('--no-open', 'do not open a browser')
  .option('--quiet', 'suppress banner and browser open (used by internal spawners)')
  .action(async (opts: { port?: string; open?: boolean; quiet?: boolean }) => {
    await runServe({
      port: opts.port ? Number.parseInt(opts.port, 10) : undefined,
      noOpen: opts.open === false,
      quiet: opts.quiet,
    });
  });

program
  .command('stop')
  .description('Stop the running collector daemon')
  .action(async () => {
    const stopped = await runStop();
    process.stdout.write(stopped ? 'stopped\n' : 'no daemon running\n');
  });

program
  .command('init')
  .description('One-shot setup: detect agents, install hooks, start daemon, open UI')
  .option('--yes', 'non-interactive mode (accept safe defaults)')
  .action(async (opts: { yes?: boolean }) => {
    try {
      await runInit({ yes: opts.yes });
    } catch (err) {
      process.stderr.write(`minspect init: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Run diagnostics: node, state dir, daemon, hooks, DB, recent events')
  .option('--json', 'emit JSON (no color; suitable for scripts)')
  .action(async (opts: { json?: boolean }) => {
    const report = await runDoctor();
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(formatDoctorReport(report));
    }
    if (report.summary.fail > 0) process.exit(1);
  });

program
  .command('uninstall')
  .description('Remove hooks written by install (dry-run by default)')
  .option('--agent <name>', 'claude-code | opencode (mutually exclusive with --all)')
  .option('--all', 'remove every agent hook + post-commit in cwd + stop daemon')
  .option('--purge', 'also delete DB, sessions, and queue under state dir')
  .option('--yes', 'actually write (default is dry-run)')
  .action(async (opts: { agent?: string; all?: boolean; purge?: boolean; yes?: boolean }) => {
    try {
      if (opts.agent && opts.agent !== 'claude-code' && opts.agent !== 'opencode') {
        process.stderr.write(`unknown agent: ${opts.agent}\n`);
        process.exit(1);
      }
      const res = await runUninstall({
        agent: opts.agent as UninstallAgent | undefined,
        all: opts.all,
        purge: opts.purge,
        yes: opts.yes,
      });
      process.stdout.write(formatUninstallReport(res));
      const anyFailed = res.steps.some((s) => s.result === 'failed');
      if (anyFailed) process.exit(2);
    } catch (err) {
      process.stderr.write(`minspect uninstall: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command('revert')
  .description('Restore files to their state before a turn or a single edit (DANGEROUS)')
  .option('--turn <id>', 'turn id to revert (all edits in that turn)')
  .option('--edit <id>', 'single edit id to revert')
  .option('--yes', 'actually write to disk (default is dry-run)')
  .option('--force', 'override drift detection (current file differs from recorded after_hash)')
  .action(async (opts: { turn?: string; edit?: string; yes?: boolean; force?: boolean }) => {
    try {
      const res = await runRevert({
        turn: opts.turn,
        edit: opts.edit,
        yes: opts.yes,
        force: opts.force,
      });
      if (res.mode === 'written' && res.skipped.length > 0) process.exit(2);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== 'drift_detected' && msg !== 'codex_source_blocked') {
        process.stderr.write(`minspect revert: ${msg}\n`);
      }
      process.exit(1);
    }
  });

program
  .command('vacuum')
  .description('Scan for data hygiene issues: orphan blame rows, orphan blobs, quarantined events')
  .option('--fix', 'actually delete orphan rows (default is dry-run)')
  .option('--clear-poison', 'actually delete quarantined events in queue/.poison/')
  .action(async (opts: { fix?: boolean; clearPoison?: boolean }) => {
    const res = await runVacuum({ fix: opts.fix, clearPoison: opts.clearPoison });
    process.stdout.write(`orphan blame rows: ${res.orphan_blame_rows}\n`);
    process.stdout.write(`orphan blobs:      ${res.orphan_blobs}\n`);
    process.stdout.write(`quarantined:       ${res.poison_events}\n`);
    if (res.mode === 'fix') {
      process.stdout.write('applied:\n');
      process.stdout.write(`  orphan_blame: ${res.removed.orphan_blame}\n`);
      process.stdout.write(`  orphan_blobs: ${res.removed.orphan_blobs}\n`);
      process.stdout.write(`  poison:       ${res.removed.poison}\n`);
    } else {
      process.stdout.write('\ndry-run. use --fix or --clear-poison to apply.\n');
    }
  });

program
  .command('import-codex')
  .description('Import Codex CLI session log(s) (~/.codex/sessions/...) into the collector')
  .option('--session <path|uuid>', 'rollout file path, or session UUID substring')
  .option('--dir <dir>', 'override Codex sessions dir (default ~/.codex/sessions)')
  .option('--latest', 'pick the newest rollout-*.jsonl under the sessions dir')
  .option('--all', 'batch-import every rollout under the sessions dir')
  .option(
    '--since <duration>',
    'with --all: only files with mtime within this window (e.g. 30d, 24h, 60m)',
  )
  .action(
    async (opts: {
      session?: string;
      dir?: string;
      latest?: boolean;
      all?: boolean;
      since?: string;
    }) => {
      try {
        if (opts.all) {
          const r = await runImportCodexAll(opts);
          process.stdout.write(
            `scanned ${r.files_scanned}, imported ${r.files_imported}, events ${r.events_sent}\n`,
          );
          if (r.errors.length > 0) {
            process.stdout.write(`  errors (${r.errors.length}):\n`);
            for (const e of r.errors.slice(0, 5)) {
              process.stdout.write(`    - ${e.file}: ${e.error}\n`);
            }
          }
          return;
        }
        const res = await runImportCodex(opts);
        process.stdout.write(`imported ${res.file}\n`);
        if (res.session_id) process.stdout.write(`  session_id: ${res.session_id}\n`);
        process.stdout.write(`  events sent: ${res.events_sent}\n`);
        if (res.warnings.length > 0) {
          process.stdout.write(`  warnings (${res.warnings.length}):\n`);
          for (const w of res.warnings.slice(0, 5)) process.stdout.write(`    - ${w}\n`);
          if (res.warnings.length > 5)
            process.stdout.write(`    ... (${res.warnings.length - 5} more)\n`);
        }
      } catch (err) {
        process.stderr.write(`minspect import-codex: ${(err as Error).message}\n`);
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv);
