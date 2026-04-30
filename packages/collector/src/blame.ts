import { createHash } from 'node:crypto';
import { diffArrays, structuredPatch } from 'diff';
import type { Store } from './store.js';

// A hunk row to insert into the `hunks` table.
export interface HunkRow {
  id: string; // `${edit_id}:${idx}`
  edit_id: string;
  old_start: number | null;
  old_count: number;
  new_start: number;
  new_count: number;
  old_text: string | null;
  new_text: string | null;
}

// Compute a hunk sequence from before → after. For a brand-new file
// (before === null) returns a single hunk covering the whole file.
export function computeHunks(editId: string, before: string | null, after: string): HunkRow[] {
  if (before === null) {
    const lines = countLines(after);
    return [
      {
        id: `${editId}:0`,
        edit_id: editId,
        old_start: null,
        old_count: 0,
        new_start: 1,
        new_count: lines,
        old_text: null,
        new_text: after,
      },
    ];
  }
  const patch = structuredPatch('a', 'a', before, after, '', '', { context: 0 });
  return patch.hunks.map((h, i) => ({
    id: `${editId}:${i}`,
    edit_id: editId,
    old_start: h.oldStart,
    old_count: h.oldLines,
    new_start: h.newStart,
    new_count: h.newLines,
    old_text: h.lines
      .filter((l) => l.startsWith('-'))
      .map((l) => l.slice(1))
      .join('\n'),
    new_text: h.lines
      .filter((l) => l.startsWith('+'))
      .map((l) => l.slice(1))
      .join('\n'),
  }));
}

export interface BlameRow {
  workspace_id: string;
  file_path: string;
  line_no: number; // 1-based
  content_hash: string;
  edit_id: string;
  turn_id: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

function countLines(text: string): number {
  return splitLines(text).length;
}

// Propagate blame across an edit. Returns the new (complete) set of
// line_blame rows for the file. Pure — no IO.
export function propagateBlame(args: {
  workspace_id: string;
  file_path: string;
  prior_blame: BlameRow[] | null; // null = no prior edit (fresh file or broken chain)
  before_lines: string[]; // lines that were on disk at Pre
  after_lines: string[];
  edit_id: string;
  turn_id: string;
}): BlameRow[] {
  const { workspace_id, file_path, prior_blame, before_lines, after_lines, edit_id, turn_id } =
    args;

  // When chain is broken or there's no prior, attribute every new line to
  // this edit.
  if (prior_blame === null) {
    return after_lines.map((line, i) => ({
      workspace_id,
      file_path,
      line_no: i + 1,
      content_hash: sha256(line),
      edit_id,
      turn_id,
    }));
  }

  // Index prior blame by old line_no for O(1) lookup.
  const priorByLine = new Map<number, BlameRow>();
  for (const row of prior_blame) priorByLine.set(row.line_no, row);

  const result: BlameRow[] = [];
  const diff = diffArrays(before_lines, after_lines);
  let oldIdx = 0; // 0-based index into before_lines
  let newIdx = 0; // 0-based index into after_lines

  for (const part of diff) {
    if (part.added) {
      for (const line of part.value) {
        newIdx += 1;
        result.push({
          workspace_id,
          file_path,
          line_no: newIdx,
          content_hash: sha256(line),
          edit_id,
          turn_id,
        });
      }
    } else if (part.removed) {
      oldIdx += part.value.length;
    } else {
      // unchanged: inherit from prior, keyed by old line number (1-based)
      for (const line of part.value) {
        oldIdx += 1;
        newIdx += 1;
        const priorRow = priorByLine.get(oldIdx);
        result.push({
          workspace_id,
          file_path,
          line_no: newIdx,
          content_hash: sha256(line),
          // If there's no prior row (e.g., file existed but wasn't captured
          // before), attribute to this edit rather than pretend it's authored.
          edit_id: priorRow?.edit_id ?? edit_id,
          turn_id: priorRow?.turn_id ?? turn_id,
        });
      }
    }
  }
  return result;
}

// Read a blob's UTF-8 text by hash, or null when the row is missing. Used by
// the historical-blame replay path; the live ingest path trusts its caller
// to pass before/after content in directly so it can stay sync-simple.
function readBlobText(store: Store, hash: string | null): string | null {
  if (hash === null) return null;
  const row = store.db.prepare('SELECT content FROM blobs WHERE hash = ?').get(hash) as
    | { content: Buffer }
    | undefined;
  if (!row) return null;
  return row.content.toString('utf8');
}

export interface HistoricalBlameResult {
  // File contents at the target revision (best-effort: '' when the after blob
  // was vacuumed, though vacuum won't prune an edit's blob by default).
  content: string;
  blame: BlameRow[];
  chain_broken_edit_ids: string[];
  target_created_at: number;
}

// Pure replay of the blame chain up to `targetEditId`, producing the state
// the user would have seen immediately after that edit landed. Mirrors the
// live `updateBlameForEdit` logic step-for-step (same chain-break rule, same
// `propagateBlame` call) so the final-step result equals what lives in
// `line_blame` today — asserted by `blame.test.ts`.
//
// Returns null when the target edit doesn't belong to this (workspace,
// file_path) pair — caller can treat it as "unknown revision".
export function computeBlameAtEdit(
  store: Store,
  workspaceId: string,
  filePath: string,
  targetEditId: string,
): HistoricalBlameResult | null {
  const target = store.db
    .prepare(
      `SELECT id, created_at, after_hash FROM edits
       WHERE id = ? AND workspace_id = ? AND file_path = ?`,
    )
    .get(targetEditId, workspaceId, filePath) as
    | { id: string; created_at: number; after_hash: string }
    | undefined;
  if (!target) return null;

  // Time-ordered slice of the chain up to and including target. Secondary
  // sort by id keeps ordering stable when two edits share a millisecond (can
  // happen during fast Codex imports).
  const chain = store.db
    .prepare(
      `SELECT id, turn_id, before_hash, after_hash, created_at FROM edits
       WHERE workspace_id = ? AND file_path = ? AND created_at <= ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(workspaceId, filePath, target.created_at) as Array<{
    id: string;
    turn_id: string;
    before_hash: string | null;
    after_hash: string;
    created_at: number;
  }>;

  const chain_broken_edit_ids: string[] = [];
  let prior_blame: BlameRow[] | null = null;
  let prior_after_hash: string | null = null;
  let blameAtTarget: BlameRow[] = [];

  for (const edit of chain) {
    // Chain-break rule matches `updateBlameForEdit`: a jump in before_hash
    // (or: we had no prior edit in this pass) resets attribution for the
    // full file so we don't claim lines the user authored. First edit of
    // the chain is always a reset from propagateBlame's perspective.
    if (prior_after_hash !== null && edit.before_hash !== prior_after_hash) {
      chain_broken_edit_ids.push(edit.id);
      prior_blame = null;
    }
    const before_content = readBlobText(store, edit.before_hash);
    const after_content = readBlobText(store, edit.after_hash) ?? '';
    const before_lines = before_content === null ? [] : splitLines(before_content);
    const after_lines = splitLines(after_content);

    // Match the live path's prior_blame gate: only inherit when the caller
    // actually had a before snapshot (i.e. the file existed).
    const use_prior = before_content !== null ? prior_blame : null;

    const next = propagateBlame({
      workspace_id: workspaceId,
      file_path: filePath,
      prior_blame: use_prior,
      before_lines,
      after_lines,
      edit_id: edit.id,
      turn_id: edit.turn_id,
    });

    if (edit.id === targetEditId) blameAtTarget = next;
    prior_blame = next;
    prior_after_hash = edit.after_hash;
  }

  const target_content = readBlobText(store, target.after_hash) ?? '';
  return {
    content: target_content,
    blame: blameAtTarget,
    chain_broken_edit_ids,
    target_created_at: target.created_at,
  };
}

// Apply blame updates for a single file edit. Uses prior state from the DB
// to propagate through the diff. Replaces hunks and line_blame rows for the
// affected (workspace_id, file_path) + edit_id.
export function updateBlameForEdit(
  store: Store,
  args: {
    edit_id: string;
    turn_id: string;
    workspace_id: string;
    file_path: string;
    before_content: string | null;
    after_content: string;
    before_hash: string | null;
  },
): void {
  const { edit_id, turn_id, workspace_id, file_path, before_content, after_content, before_hash } =
    args;

  // Replace hunks for this edit.
  store.db.prepare('DELETE FROM hunks WHERE edit_id = ?').run(edit_id);
  store.db.prepare('DELETE FROM explain_queue WHERE hunk_id LIKE ?').run(`${edit_id}:%`);
  const hunks = computeHunks(edit_id, before_content, after_content);
  const insertHunk = store.db.prepare(
    `INSERT INTO hunks (id, edit_id, old_start, old_count, new_start, new_count, old_text, new_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertQueue = store.db.prepare(
    'INSERT OR IGNORE INTO explain_queue (hunk_id, enqueued_at, attempts) VALUES (?, ?, 0)',
  );
  const now = Date.now();
  for (const h of hunks) {
    insertHunk.run(
      h.id,
      h.edit_id,
      h.old_start,
      h.old_count,
      h.new_start,
      h.new_count,
      h.old_text,
      h.new_text,
    );
    insertQueue.run(h.id, now);
  }

  // Decide whether to inherit prior blame. Chain is "broken" if the prior
  // edit's after_hash does not equal this edit's before_hash — implying the
  // user (or something else) modified the file between edits.
  const prior = store.db
    .prepare(
      `SELECT id, after_hash FROM edits
       WHERE workspace_id = ? AND file_path = ? AND id != ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(workspace_id, file_path, edit_id) as { id: string; after_hash: string } | undefined;

  let prior_blame: BlameRow[] | null = null;
  if (before_content !== null) {
    if (prior && prior.after_hash === before_hash) {
      prior_blame = store.db
        .prepare(
          `SELECT workspace_id, file_path, line_no, content_hash, edit_id, turn_id
           FROM line_blame WHERE workspace_id = ? AND file_path = ?`,
        )
        .all(workspace_id, file_path) as BlameRow[];
    }
  }

  const newBlame = propagateBlame({
    workspace_id,
    file_path,
    prior_blame,
    before_lines: before_content === null ? [] : splitLines(before_content),
    after_lines: splitLines(after_content),
    edit_id,
    turn_id,
  });

  store.db
    .prepare('DELETE FROM line_blame WHERE workspace_id = ? AND file_path = ?')
    .run(workspace_id, file_path);
  const insertBlame = store.db.prepare(
    `INSERT INTO line_blame (workspace_id, file_path, line_no, content_hash, edit_id, turn_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const b of newBlame)
    insertBlame.run(b.workspace_id, b.file_path, b.line_no, b.content_hash, b.edit_id, b.turn_id);
}
