import { createHash } from 'node:crypto';
import {
  type Event,
  type FileEdit,
  type SessionEndEvent,
  type SessionStartEvent,
  type ToolCallEvent,
  type ToolCallExplanationEvent,
  type TurnEndEvent,
  type TurnStartEvent,
  applyMigrations,
  hasSearchIndex,
} from '@minspect/core';
import Database, { type Database as DBType } from 'better-sqlite3';
import { updateAstForEdit } from './ast.js';
import { updateBlameForEdit } from './blame.js';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

export class Store {
  readonly db: DBType;
  readonly ftsEnabled: boolean;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    applyMigrations(this.db);
    this.ftsEnabled = hasSearchIndex(this.db);
    if (this.ftsEnabled) this.backfillSearchIndex();
  }

  close(): void {
    this.db.close();
  }

  // Delete a session and all related data in a single transaction.
  // Returns true if the session existed and was deleted, false if not found.
  deleteSession(sessionId: string): boolean {
    const txn = this.db.transaction(() => {
      const session = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return false;

      // Delete in dependency order (child tables first).
      // tool_calls (via turns)
      this.db.prepare(
        `DELETE FROM tool_calls WHERE turn_id IN (SELECT id FROM turns WHERE session_id = ?)`,
      ).run(sessionId);
      // hunks (via edits)
      this.db.prepare(
        `DELETE FROM hunks WHERE edit_id IN (SELECT id FROM edits WHERE session_id = ?)`,
      ).run(sessionId);
      // line_blame (via edits)
      this.db.prepare(
        `DELETE FROM line_blame WHERE edit_id IN (SELECT id FROM edits WHERE session_id = ?)`,
      ).run(sessionId);
      // commit_links (via edits)
      this.db.prepare(
        `DELETE FROM commit_links WHERE edit_id IN (SELECT id FROM edits WHERE session_id = ?)`,
      ).run(sessionId);
      // edit_ast_impact (via edits)
      this.db.prepare(
        `DELETE FROM edit_ast_impact WHERE edit_id IN (SELECT id FROM edits WHERE session_id = ?)`,
      ).run(sessionId);
      // search_index (direct session_id)
      if (this.ftsEnabled) {
        this.db.prepare('DELETE FROM search_index WHERE session_id = ?').run(sessionId);
      }
      // turns
      this.db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
      // edits
      this.db.prepare('DELETE FROM edits WHERE session_id = ?').run(sessionId);
      // sessions
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      return true;
    });
    return txn();
  }

  // One-shot backfill: if search_index is empty but there's existing content
  // (upgrade case), replay turns / tool_calls / edits into the FTS table.
  // Runs in the constructor and is a no-op once rows exist.
  private backfillSearchIndex(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as {
      n: number;
    };
    if (countRow.n > 0) return;
    const hasTurns = (this.db.prepare('SELECT COUNT(*) AS n FROM turns').get() as { n: number }).n;
    if (hasTurns === 0) return; // fresh DB, nothing to backfill

    const ins = this.db.prepare(
      'INSERT INTO search_index (kind, source_id, session_id, workspace_id, content) VALUES (?, ?, ?, ?, ?)',
    );
    const txn = this.db.transaction(() => {
      // prompts + reasoning + messages — joined back to sessions for workspace_id.
      const turns = this.db
        .prepare(
          `SELECT t.id, t.session_id, s.workspace_id,
                  t.user_prompt, t.agent_reasoning, t.agent_final_message
           FROM turns t JOIN sessions s ON s.id = t.session_id`,
        )
        .all() as Array<{
        id: string;
        session_id: string;
        workspace_id: string;
        user_prompt: string;
        agent_reasoning: string | null;
        agent_final_message: string | null;
      }>;
      for (const t of turns) {
        if (t.user_prompt) ins.run('prompt', t.id, t.session_id, t.workspace_id, t.user_prompt);
        if (t.agent_reasoning) {
          ins.run('reasoning', t.id, t.session_id, t.workspace_id, t.agent_reasoning);
        }
        if (t.agent_final_message) {
          ins.run('message', t.id, t.session_id, t.workspace_id, t.agent_final_message);
        }
      }

      const tcs = this.db
        .prepare(
          `SELECT tc.id, tc.explanation, t.session_id, s.workspace_id
           FROM tool_calls tc
             JOIN turns t ON t.id = tc.turn_id
             JOIN sessions s ON s.id = t.session_id
           WHERE tc.explanation IS NOT NULL AND tc.explanation != ''`,
        )
        .all() as Array<{
        id: string;
        explanation: string;
        session_id: string;
        workspace_id: string;
      }>;
      for (const tc of tcs) {
        ins.run('explanation', tc.id, tc.session_id, tc.workspace_id, tc.explanation);
      }

      // De-duped file paths: one FTS row per (edit_id) so we can route to the
      // edit's turn, but search is over the path text.
      const edits = this.db
        .prepare('SELECT id, session_id, workspace_id, file_path FROM edits')
        .all() as Array<{
        id: string;
        session_id: string;
        workspace_id: string;
        file_path: string;
      }>;
      for (const e of edits) {
        ins.run('file_path', e.id, e.session_id, e.workspace_id, e.file_path);
      }
    });
    txn();
  }

  // Insert helper. Preparing on every call is a few microseconds per insert
  // in better-sqlite3 and keeps us out of the generic-typed statement cache.
  private ftsInsert(
    kind: string,
    sourceId: string,
    sessionId: string,
    workspaceId: string,
    content: string,
  ): void {
    if (!this.ftsEnabled || !content) return;
    this.db
      .prepare(
        'INSERT INTO search_index (kind, source_id, session_id, workspace_id, content) VALUES (?, ?, ?, ?, ?)',
      )
      .run(kind, sourceId, sessionId, workspaceId, content);
  }

  // Insert an event in a single transaction. Duplicate events (same id) are
  // ignored rather than erroring so retries from the disk queue are safe.
  ingest(event: Event): void {
    const txn = this.db.transaction((e: Event) => this.apply(e));
    txn(event);
  }

  private apply(e: Event): void {
    switch (e.type) {
      case 'session_start':
        this.onSessionStart(e);
        return;
      case 'turn_start':
        this.onTurnStart(e);
        return;
      case 'tool_call':
        this.onToolCall(e);
        return;
      case 'turn_end':
        this.onTurnEnd(e);
        return;
      case 'session_end':
        this.onSessionEnd(e);
        return;
      case 'tool_call_explanation':
        this.onToolCallExplanation(e);
        return;
    }
  }

  private onSessionStart(e: SessionStartEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO workspaces (id, path, git_remote, created_at)
         VALUES (?, ?, NULL, ?)`,
      )
      .run(e.workspace, e.workspace, e.timestamp);

    this.db
      .prepare(
        `INSERT INTO sessions (id, workspace_id, agent, agent_version, started_at, ended_at, git_branch_start, git_head_start)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        e.session_id,
        e.workspace,
        e.agent,
        e.agent_version ?? null,
        e.timestamp,
        e.git.branch,
        e.git.head,
      );
  }

  private onTurnStart(e: TurnStartEvent): void {
    const res = this.db
      .prepare(
        `INSERT INTO turns (id, session_id, idx, user_prompt, agent_reasoning, agent_final_message, started_at, ended_at, git_head)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(e.turn_id, e.session_id, e.idx, e.user_prompt, e.timestamp, e.git.head);
    if (res.changes > 0 && e.user_prompt) {
      const wsid = this.workspaceIdFor(e.session_id);
      if (wsid) this.ftsInsert('prompt', e.turn_id, e.session_id, wsid, e.user_prompt);
    }
  }

  // Cached lookup for workspace_id given a session_id. Called from every FTS
  // write on the ingest path — avoid N extra queries.
  private workspaceIdFor(sessionId: string): string | null {
    const row = this.db.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get(sessionId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  }

  private onToolCall(e: ToolCallEvent): void {
    const session = this.db
      .prepare('SELECT workspace_id FROM sessions WHERE id = ?')
      .get(e.session_id) as { workspace_id: string } | undefined;
    if (!session) {
      throw new Error(`tool_call references unknown session_id=${e.session_id}`);
    }
    const turn = this.db.prepare('SELECT git_head FROM turns WHERE id = ?').get(e.turn_id) as
      | { git_head: string | null }
      | undefined;
    const gitHead = turn?.git_head ?? null;

    this.db
      .prepare(
        `INSERT INTO tool_calls (id, turn_id, idx, tool_name, input_json, output_json, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        e.tool_call_id,
        e.turn_id,
        e.idx,
        e.tool_name,
        JSON.stringify(e.input),
        e.output !== undefined ? JSON.stringify(e.output) : null,
        e.status,
        e.started_at,
        e.ended_at,
      );

    const edits = e.file_edits ?? [];
    for (let i = 0; i < edits.length; i++) {
      const fe = edits[i];
      if (!fe) continue;
      this.writeFileEdit(
        e.tool_call_id,
        e.turn_id,
        e.session_id,
        session.workspace_id,
        gitHead,
        e.started_at,
        fe,
        i,
      );
    }
  }

  private writeFileEdit(
    toolCallId: string,
    turnId: string,
    sessionId: string,
    workspaceId: string,
    gitHead: string | null,
    createdAt: number,
    fe: FileEdit,
    idx: number,
  ): void {
    const beforeHash = fe.before_content === null ? null : sha256(fe.before_content);
    const afterHash = sha256(fe.after_content);

    const putBlob = this.db.prepare('INSERT OR IGNORE INTO blobs (hash, content) VALUES (?, ?)');
    if (fe.before_content !== null) {
      putBlob.run(beforeHash, Buffer.from(fe.before_content, 'utf8'));
    }
    putBlob.run(afterHash, Buffer.from(fe.after_content, 'utf8'));

    const editId = `${toolCallId}:${idx}`;
    this.db
      .prepare(
        `INSERT INTO edits (id, tool_call_id, turn_id, session_id, workspace_id, file_path, before_hash, after_hash, created_at, git_head)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        editId,
        toolCallId,
        turnId,
        sessionId,
        workspaceId,
        fe.file_path,
        beforeHash,
        afterHash,
        createdAt,
        gitHead,
      );

    // Line-level hunks + line_blame (card 07).
    updateBlameForEdit(this, {
      edit_id: editId,
      turn_id: turnId,
      workspace_id: workspaceId,
      file_path: fe.file_path,
      before_content: fe.before_content,
      after_content: fe.after_content,
      before_hash: beforeHash,
    });
    // AST nodes + edit_ast_impact (card 08).
    updateAstForEdit(this, {
      edit_id: editId,
      workspace_id: workspaceId,
      file_path: fe.file_path,
      after_content: fe.after_content,
    });
    // Card 33: index the file_path so ⌘K search can find sessions by file.
    this.ftsInsert('file_path', editId, sessionId, workspaceId, fe.file_path);
  }

  private onTurnEnd(e: TurnEndEvent): void {
    // Read the prior values so we can detect which (if any) fields we actually
    // wrote this call. COALESCE makes turn_end writes idempotent — FTS should
    // only index the *first* non-null value to avoid duplicate rows.
    const before = this.db
      .prepare('SELECT session_id, user_prompt, agent_reasoning, agent_final_message FROM turns WHERE id = ?')
      .get(e.turn_id) as
      | { session_id: string; user_prompt: string; agent_reasoning: string | null; agent_final_message: string | null }
      | undefined;
    this.db
      .prepare(
        `UPDATE turns
         SET ended_at = COALESCE(ended_at, ?),
             agent_reasoning = COALESCE(agent_reasoning, ?),
             agent_final_message = COALESCE(agent_final_message, ?),
             user_prompt = CASE WHEN user_prompt = '' AND ? != '' THEN ? ELSE user_prompt END
         WHERE id = ?`,
      )
      .run(e.timestamp, e.agent_reasoning ?? null, e.agent_final_message ?? null, e.user_prompt ?? '', e.user_prompt ?? '', e.turn_id);
    if (before) {
      const wsid = this.workspaceIdFor(before.session_id);
      if (wsid) {
        if (before.user_prompt === '' && e.user_prompt) {
          this.ftsInsert('prompt', e.turn_id, before.session_id, wsid, e.user_prompt);
        }
        if (before.agent_reasoning == null && e.agent_reasoning) {
          this.ftsInsert('reasoning', e.turn_id, before.session_id, wsid, e.agent_reasoning);
        }
        if (before.agent_final_message == null && e.agent_final_message) {
          this.ftsInsert('message', e.turn_id, before.session_id, wsid, e.agent_final_message);
        }
      }
    }
  }

  private onSessionEnd(e: SessionEndEvent): void {
    this.db
      .prepare('UPDATE sessions SET ended_at = COALESCE(ended_at, ?) WHERE id = ?')
      .run(e.timestamp, e.session_id);
  }

  // Match transcript-derived tool preamble to the tool_call row from the same
  // turn by content, then fill `tool_calls.explanation`. Overwrites NULL only
  // (retries and re-runs don't clobber an existing explanation).
  private onToolCallExplanation(e: ToolCallExplanationEvent): void {
    const rows = this.db
      .prepare(
        `SELECT id, input_json, explanation FROM tool_calls
         WHERE turn_id = ? AND tool_name = ? ORDER BY idx`,
      )
      .all(e.turn_id, e.tool_name) as Array<{
      id: string;
      input_json: string;
      explanation: string | null;
    }>;
    if (rows.length === 0) return;

    // Exact-match first (canonical JSON), then fall back to salient-field
    // match (file_path + old_string / content / command) to tolerate minor
    // serialization drift. Among multiple viable matches, prefer one whose
    // explanation is still NULL so we fill in order.
    const canonicalTarget = canonicalJson(e.input);
    const salientTarget = salientSignature(e.tool_name, e.input);

    let hit: { id: string } | undefined;
    for (const r of rows) {
      if (r.explanation !== null) continue; // already filled, skip
      if (canonicalJson(safeParse(r.input_json)) === canonicalTarget) {
        hit = r;
        break;
      }
    }
    if (!hit && salientTarget !== null) {
      for (const r of rows) {
        if (r.explanation !== null) continue;
        if (salientSignature(e.tool_name, safeParse(r.input_json)) === salientTarget) {
          hit = r;
          break;
        }
      }
    }
    if (!hit) return;

    const res = this.db
      .prepare('UPDATE tool_calls SET explanation = COALESCE(explanation, ?) WHERE id = ?')
      .run(e.explanation, hit.id);
    // Only write to FTS when COALESCE actually replaced NULL — avoid duplicate
    // rows across retries. `changes` tracks *matched* rows, so we separately
    // check that the row previously had no explanation.
    if (res.changes > 0) {
      const priorNull = rows.find((r) => r.id === hit?.id && r.explanation === null);
      if (priorNull) {
        const wsid = this.db
          .prepare(
            'SELECT s.workspace_id AS workspace_id, s.id AS session_id FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.id = ?',
          )
          .get(e.turn_id) as { workspace_id: string; session_id: string } | undefined;
        if (wsid) {
          this.ftsInsert('explanation', hit.id, wsid.session_id, wsid.workspace_id, e.explanation);
        }
      }
    }
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Stable stringify — object keys sorted, arrays preserved.
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) sorted[k] = (val as Record<string, unknown>)[k];
      return sorted;
    }
    return val;
  });
}

// Tool-specific signature — tolerates noise fields (replace_all defaults etc).
function salientSignature(tool: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  switch (tool) {
    case 'Edit':
      return JSON.stringify([i.file_path, i.old_string, i.new_string]);
    case 'Write':
      return JSON.stringify([i.file_path, i.content]);
    case 'MultiEdit':
      return JSON.stringify([i.file_path, i.edits]);
    case 'Bash':
      return JSON.stringify([i.command, i.description ?? null]);
    default:
      return canonicalJson(input);
  }
}
