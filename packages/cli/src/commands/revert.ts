import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readCollectorTarget } from '../transport.js';

export interface RevertOptions {
  turn?: string;
  edit?: string;
  dryRun?: boolean; // default true
  yes?: boolean; // must be true to actually write
  force?: boolean; // override drift check
  stateRoot?: string;
}

interface PlanFile {
  file_path: string;
  workspace_id: string;
  before_hash: string | null;
  after_hash: string;
  expected_current_hash: string;
  kind: 'restore' | 'delete';
}

interface RevertPlan {
  target_kind: 'turn' | 'edit';
  target_id: string;
  source_agent: string | null;
  files: PlanFile[];
  warnings: {
    codex_source: boolean;
    chain_broken_user_edits: Array<{ file_path: string; at_edit_id: string }>;
    later_edits_will_be_lost: Array<{
      file_path: string;
      edit_id: string;
      turn_id: string;
      turn_idx: number | null;
    }>;
  };
}

interface ErrorResponse {
  error: string;
}

export interface RevertResult {
  plan: RevertPlan;
  written: Array<{ file_path: string; action: 'restored' | 'deleted' }>;
  skipped: Array<{ file_path: string; reason: string }>;
  mode: 'dry-run' | 'written';
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // Try to extract a JSON error body; fall back to status text.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const err = (body as ErrorResponse | undefined)?.error ?? res.statusText;
    throw new Error(`${res.status} ${err}`);
  }
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

// ANSI colour helpers — keep it tiny, no chalk.
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

export async function runRevert(options: RevertOptions): Promise<RevertResult> {
  if ((!options.turn && !options.edit) || (options.turn && options.edit)) {
    throw new Error('specify exactly one of --turn <id> or --edit <id>');
  }
  const target = readCollectorTarget(options.stateRoot);
  if (!target) {
    throw new Error('collector daemon is not running — start it with `minspect serve`');
  }
  const base = `http://${target.host ?? '127.0.0.1'}:${target.port}`;
  const q = options.turn
    ? `turn=${encodeURIComponent(options.turn)}`
    : `edit=${encodeURIComponent(options.edit as string)}`;

  const plan = await fetchJson<RevertPlan>(`${base}/api/revert/plan?${q}`);

  // Hard block: Codex-imported sessions only have hunk-window before/after,
  // not full-file blobs. Rolling back would clobber the rest of the file.
  if (plan.warnings.codex_source) {
    process.stderr.write(
      `${RED('error:')} refusing to revert a Codex-imported session.
  Codex \`apply_patch\` logs only capture hunk windows, not full-file
  snapshots — restoring a blob would overwrite unrelated regions.
  Use \`git checkout\` / manual review instead.
`,
    );
    throw new Error('codex_source_blocked');
  }

  const dryRun = options.dryRun !== false && options.yes !== true;

  // Preview: what we'd do, and why.
  const lines: string[] = [];
  const sourceTag = plan.source_agent ? DIM(` (${plan.source_agent})`) : '';
  lines.push(`${DIM('Revert plan for')} ${plan.target_kind} ${DIM(plan.target_id)}${sourceTag}`);
  for (const f of plan.files) {
    const label = f.kind === 'delete' ? 'delete' : 'restore';
    lines.push(`  ${GREEN(`[${label}]`)} ${f.file_path}`);
  }
  if (plan.warnings.later_edits_will_be_lost.length > 0) {
    lines.push(
      YELLOW(
        `  warning: ${plan.warnings.later_edits_will_be_lost.length} later AI edit(s) on these files will also be undone:`,
      ),
    );
    for (const l of plan.warnings.later_edits_will_be_lost.slice(0, 10)) {
      lines.push(`    ${l.file_path}  ${DIM(`turn ${l.turn_idx ?? '?'} (${l.edit_id})`)}`);
    }
    if (plan.warnings.later_edits_will_be_lost.length > 10) {
      lines.push(`    ${DIM(`... ${plan.warnings.later_edits_will_be_lost.length - 10} more`)}`);
    }
  }
  if (plan.warnings.chain_broken_user_edits.length > 0) {
    lines.push(
      YELLOW('  warning: user-made edits detected in between — these will be overwritten:'),
    );
    for (const c of plan.warnings.chain_broken_user_edits) {
      lines.push(`    ${c.file_path}  ${DIM(`at ${c.at_edit_id}`)}`);
    }
  }

  // Drift detection — compare on-disk content hash to expected_current_hash.
  const drift: Array<{ file_path: string; expected: string; actual: string }> = [];
  for (const f of plan.files) {
    if (!existsSync(f.file_path)) {
      // File missing on disk: if expected to exist (expected_current_hash not empty-file), flag drift.
      if (f.expected_current_hash !== sha256('')) {
        drift.push({
          file_path: f.file_path,
          expected: f.expected_current_hash,
          actual: '<missing>',
        });
      }
      continue;
    }
    const cur = readFileSync(f.file_path, 'utf8');
    const actual = sha256(cur);
    if (actual !== f.expected_current_hash) {
      drift.push({ file_path: f.file_path, expected: f.expected_current_hash, actual });
    }
  }
  if (drift.length > 0) {
    lines.push(
      RED(`  drift: ${drift.length} file(s) have changed since minspect last recorded them`),
    );
    for (const d of drift) {
      lines.push(
        `    ${d.file_path}  ${DIM(`expected ${d.expected.slice(0, 8)}, got ${d.actual.slice(0, 8)}`)}`,
      );
    }
    if (!options.force) {
      lines.push(RED('  aborting. pass --force to overwrite anyway.'));
    }
  }

  for (const ln of lines) process.stderr.write(`${ln}\n`);

  if (drift.length > 0 && !options.force) {
    throw new Error('drift_detected');
  }

  if (dryRun) {
    process.stderr.write(`${DIM('dry-run. re-run with `--yes` to apply.')}\n`);
    return { plan, written: [], skipped: [], mode: 'dry-run' };
  }

  // Actually apply.
  const written: Array<{ file_path: string; action: 'restored' | 'deleted' }> = [];
  const skipped: Array<{ file_path: string; reason: string }> = [];

  for (const f of plan.files) {
    if (f.kind === 'delete') {
      // AI created this file; revert = delete it.
      try {
        rmSync(f.file_path, { force: true });
        written.push({ file_path: f.file_path, action: 'deleted' });
      } catch (e) {
        skipped.push({ file_path: f.file_path, reason: (e as Error).message });
      }
      continue;
    }
    if (!f.before_hash) {
      skipped.push({ file_path: f.file_path, reason: 'no before_hash recorded' });
      continue;
    }
    let content: string;
    try {
      content = await fetchText(`${base}/api/blobs/${f.before_hash}`);
    } catch (e) {
      skipped.push({
        file_path: f.file_path,
        reason: `blob ${f.before_hash.slice(0, 8)} unavailable: ${(e as Error).message}`,
      });
      continue;
    }
    try {
      mkdirSync(dirname(f.file_path), { recursive: true });
      writeFileSync(f.file_path, content, 'utf8');
      written.push({ file_path: f.file_path, action: 'restored' });
    } catch (e) {
      skipped.push({ file_path: f.file_path, reason: (e as Error).message });
    }
  }

  process.stderr.write(`${GREEN(`restored/deleted ${written.length} file(s)`)}\n`);
  if (skipped.length > 0) {
    process.stderr.write(YELLOW(`skipped ${skipped.length}:\n`));
    for (const s of skipped) process.stderr.write(`  ${s.file_path}: ${s.reason}\n`);
  }

  return { plan, written, skipped, mode: 'written' };
}
