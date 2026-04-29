import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseCodexLog } from '@minspect/adapter-codex';
import type { Event } from '@minspect/core';
import { sendEvent } from '../transport.js';

export interface ImportCodexOptions {
  session?: string; // absolute path, or session-uuid (scanned against sessions dir)
  dir?: string; // override ~/.codex/sessions
  latest?: boolean; // pick newest rollout-*.jsonl
  all?: boolean; // batch import every rollout under `dir`
  since?: string; // with --all: keep only files with mtime within this window (e.g. `30d`, `24h`, `60m`)
  stateRoot?: string; // override for tests
}

export interface ImportCodexResult {
  file: string;
  session_id?: string;
  events_sent: number;
  warnings: string[];
}

// --all / --since returns a batch summary instead of one file's result.
export interface ImportCodexBatchResult {
  files_scanned: number;
  files_imported: number;
  events_sent: number;
  sessions: string[];
  errors: Array<{ file: string; error: string }>;
}

// `30d` / `24h` / `60m` / `45s` → milliseconds. Returns null on malformed input.
export function parseDuration(s: string): number | null {
  const m = /^(\d+)\s*([smhd])$/i.exec(s.trim());
  if (!m) return null;
  const [, n, unit] = m;
  const n2 = Number.parseInt(n ?? '0', 10);
  if (!Number.isFinite(n2) || n2 <= 0) return null;
  const mult: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const mu = mult[(unit ?? '').toLowerCase()];
  return mu ? n2 * mu : null;
}

function defaultSessionsDir(): string {
  return join(homedir(), '.codex', 'sessions');
}

function walkRollouts(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const visit = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(p);
      else if (name.endsWith('.jsonl') && name.startsWith('rollout-')) out.push(p);
    }
  };
  visit(dir);
  return out;
}

function pickFile(opts: ImportCodexOptions): string {
  const dir = opts.dir ?? defaultSessionsDir();
  const sessionKey = opts.session;
  if (sessionKey) {
    const abs = resolve(sessionKey);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
    // Treat as UUID: search by substring in filename.
    const all = walkRollouts(dir);
    const hit = all.find((p) => basename(p).includes(sessionKey));
    if (!hit) throw new Error(`no rollout file matching session "${sessionKey}" under ${dir}`);
    return hit;
  }
  const all = walkRollouts(dir);
  if (all.length === 0) throw new Error(`no rollout-*.jsonl files under ${dir}`);
  if (opts.latest) {
    const sorted = all.map((p) => ({ p, t: statSync(p).mtimeMs })).sort((a, b) => b.t - a.t);
    const top = sorted[0];
    if (!top) throw new Error(`no rollout-*.jsonl files under ${dir}`);
    return top.p;
  }
  throw new Error('specify --session <path|uuid> or --latest');
}

export async function runImportCodex(opts: ImportCodexOptions = {}): Promise<ImportCodexResult> {
  const file = pickFile(opts);
  const content = readFileSync(file, 'utf8');
  const parsed = parseCodexLog(content);
  let sent = 0;
  for (const ev of parsed.events as Event[]) {
    await sendEvent(ev, opts.stateRoot);
    sent++;
  }
  return {
    file,
    session_id: parsed.session_id,
    events_sent: sent,
    warnings: parsed.warnings,
  };
}

// Batch import: scan `dir` (default `~/.codex/sessions`), filter by mtime if
// `--since` is given, and import each file individually. Dedup relies on the
// collector's ON CONFLICT DO NOTHING — re-importing the same session is a
// no-op at the DB layer, but we still parse & POST each line so there's CPU
// cost. For hourly background jobs use `--since 1d` to keep the scan cheap.
export async function runImportCodexAll(
  opts: ImportCodexOptions = {},
): Promise<ImportCodexBatchResult> {
  const dir = opts.dir ?? defaultSessionsDir();
  let files = walkRollouts(dir);
  if (opts.since) {
    const windowMs = parseDuration(opts.since);
    if (windowMs == null) {
      throw new Error(`invalid --since value: "${opts.since}" (expected e.g. 30d / 24h / 60m)`);
    }
    const cutoff = Date.now() - windowMs;
    files = files.filter((p) => {
      try {
        return statSync(p).mtimeMs >= cutoff;
      } catch {
        return false;
      }
    });
  }
  const result: ImportCodexBatchResult = {
    files_scanned: files.length,
    files_imported: 0,
    events_sent: 0,
    sessions: [],
    errors: [],
  };
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const parsed = parseCodexLog(content);
      for (const ev of parsed.events as Event[]) {
        await sendEvent(ev, opts.stateRoot);
        result.events_sent++;
      }
      if (parsed.session_id) result.sessions.push(parsed.session_id);
      result.files_imported++;
    } catch (e) {
      result.errors.push({ file, error: (e as Error).message });
    }
  }
  return result;
}
