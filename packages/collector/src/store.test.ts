import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'abc', dirty: false };

function openStore(): Store {
  return new Store(':memory:');
}

function makeSessionStart(sessionId = 's1', workspace = '/tmp/r'): Event {
  return {
    type: 'session_start',
    session_id: sessionId,
    agent: 'claude-code',
    workspace,
    git,
    timestamp: 1,
  };
}

function makeTurnStart(sessionId = 's1', turnId = 't1', idx = 0): Event {
  return {
    type: 'turn_start',
    session_id: sessionId,
    turn_id: turnId,
    idx,
    user_prompt: 'hello',
    git,
    timestamp: 2,
  };
}

describe('Store.ingest', () => {
  it('persists session_start and turn_start', () => {
    const store = openStore();
    store.ingest(makeSessionStart());
    store.ingest(makeTurnStart());
    const sessions = store.db.prepare('SELECT * FROM sessions').all();
    const turns = store.db.prepare('SELECT * FROM turns').all();
    expect(sessions).toHaveLength(1);
    expect(turns).toHaveLength(1);
    store.close();
  });

  it('dedups blobs by sha256 hash', () => {
    const store = openStore();
    store.ingest(makeSessionStart());
    store.ingest(makeTurnStart());

    const toolCall = (editIdx: number, content: string): Event => ({
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't1',
      tool_call_id: `tc${editIdx}`,
      idx: editIdx,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: 'a.ts', before_content: null, after_content: content }],
      started_at: 10,
      ended_at: 11,
    });

    store.ingest(toolCall(0, 'same-content'));
    store.ingest(toolCall(1, 'same-content'));
    store.ingest(toolCall(2, 'different-content'));

    const blobs = store.db.prepare('SELECT COUNT(*) as c FROM blobs').get() as { c: number };
    // 'same-content' stored once, 'different-content' once → 2 distinct blobs
    expect(blobs.c).toBe(2);

    const edits = store.db.prepare('SELECT COUNT(*) as c FROM edits').get() as { c: number };
    expect(edits.c).toBe(3);

    store.close();
  });

  it('writes per-diff hunks for edits and a whole-file hunk for new files', () => {
    const store = openStore();
    store.ingest(makeSessionStart());
    store.ingest(makeTurnStart());
    store.ingest({
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't1',
      tool_call_id: 'tc1',
      idx: 0,
      tool_name: 'MultiEdit',
      input: {},
      status: 'ok',
      file_edits: [
        { file_path: 'a.ts', before_content: 'a\nb\nc', after_content: 'a\nb2\nc' },
        { file_path: 'b.ts', before_content: null, after_content: 'new' },
      ],
      started_at: 10,
      ended_at: 11,
    });
    // a.ts: single-line replace → 1 hunk with context:0
    const aHunks = store.db
      .prepare("SELECT * FROM hunks WHERE edit_id = 'tc1:0' ORDER BY id")
      .all();
    expect(aHunks.length).toBeGreaterThanOrEqual(1);
    // b.ts: new file → exactly one whole-file hunk with old_start null
    const bHunks = store.db.prepare("SELECT * FROM hunks WHERE edit_id = 'tc1:1'").all() as Array<{
      old_start: number | null;
      new_count: number;
    }>;
    expect(bHunks).toHaveLength(1);
    expect(bHunks[0]?.old_start).toBeNull();
    store.close();
  });

  it('is idempotent on repeat ingestion (same event id)', () => {
    const store = openStore();
    store.ingest(makeSessionStart());
    store.ingest(makeSessionStart()); // retry from disk queue, same id
    const sessions = store.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number };
    expect(sessions.c).toBe(1);
    store.close();
  });

  it('fills turn_end reasoning and session_end ended_at', () => {
    const store = openStore();
    store.ingest(makeSessionStart());
    store.ingest(makeTurnStart());
    store.ingest({
      type: 'turn_end',
      turn_id: 't1',
      agent_reasoning: 'because',
      agent_final_message: 'done',
      timestamp: 99,
    });
    store.ingest({ type: 'session_end', session_id: 's1', timestamp: 100 });

    const turn = store.db.prepare('SELECT * FROM turns').get() as {
      agent_reasoning: string | null;
      ended_at: number | null;
    };
    expect(turn.agent_reasoning).toBe('because');
    expect(turn.ended_at).toBe(99);

    const session = store.db.prepare('SELECT * FROM sessions').get() as {
      ended_at: number | null;
    };
    expect(session.ended_at).toBe(100);
    store.close();
  });

  it('rolls back the transaction on failure (tool_call with unknown session)', () => {
    const store = openStore();
    expect(() =>
      store.ingest({
        type: 'tool_call',
        session_id: 'nonexistent',
        turn_id: 't1',
        tool_call_id: 'tc1',
        idx: 0,
        tool_name: 'Edit',
        input: {},
        status: 'ok',
        started_at: 1,
        ended_at: 2,
      }),
    ).toThrow(/unknown session_id/);
    const toolCalls = store.db.prepare('SELECT COUNT(*) as c FROM tool_calls').get() as {
      c: number;
    };
    expect(toolCalls.c).toBe(0);
    store.close();
  });

  // Card 33: FTS5 search index side-effects on the ingest path.
  it('writes prompt, reasoning, message, explanation, and file_path into search_index', () => {
    const store = openStore();
    expect(store.ftsEnabled).toBe(true);
    store.ingest(makeSessionStart('s1', '/ws'));
    store.ingest({
      type: 'turn_start',
      session_id: 's1',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'fix the login bug',
      git,
      timestamp: 10,
    });
    store.ingest({
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't1',
      tool_call_id: 'tc1',
      idx: 0,
      tool_name: 'Write',
      input: { file_path: 'src/auth/login.ts', content: 'x' },
      status: 'ok',
      started_at: 11,
      ended_at: 12,
      file_edits: [{ file_path: 'src/auth/login.ts', before_content: null, after_content: 'x' }],
    });
    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Write',
      input: { file_path: 'src/auth/login.ts', content: 'x' },
      explanation: 'refactor login helper',
      timestamp: 13,
    });
    store.ingest({
      type: 'turn_end',
      turn_id: 't1',
      agent_reasoning: 'planning the authentication rewrite',
      agent_final_message: 'done',
      timestamp: 20,
    });

    const kinds = (
      store.db
        .prepare('SELECT kind, source_id, content FROM search_index ORDER BY kind, source_id')
        .all() as Array<{ kind: string; source_id: string; content: string }>
    ).map((r) => [r.kind, r.source_id]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['explanation', 'tc1'],
        ['file_path', 'tc1:0'],
        ['message', 't1'],
        ['prompt', 't1'],
        ['reasoning', 't1'],
      ]),
    );

    // MATCH across the indexed content works end-to-end.
    const hits = store.db
      .prepare(
        `SELECT kind, source_id FROM search_index
         WHERE search_index MATCH 'login' ORDER BY bm25(search_index)`,
      )
      .all() as Array<{ kind: string; source_id: string }>;
    const kindSet = new Set(hits.map((h) => h.kind));
    // prompt says "login bug", explanation says "login helper", file_path is
    // "src/auth/login.ts". All three should hit.
    expect(kindSet.has('prompt')).toBe(true);
    expect(kindSet.has('explanation')).toBe(true);
    expect(kindSet.has('file_path')).toBe(true);
    store.close();
  });

  it('backfills existing rows into search_index on Store construction', () => {
    // Step 1: build up a DB with events, then close.
    const s1 = openStore();
    const path = ':memory:'; // separate memory DB, but reuse same handle via s1
    void path;
    s1.ingest(makeSessionStart('s1', '/ws'));
    s1.ingest({
      type: 'turn_start',
      session_id: 's1',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'make the api faster',
      git,
      timestamp: 10,
    });
    // Simulate "old DB": wipe search_index, then re-run constructor logic by
    // calling backfill manually via a second Store over the same handle.
    s1.db.exec('DELETE FROM search_index');
    expect((s1.db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n).toBe(
      0,
    );

    // Backfill: a second Store that reads the in-memory db would be a
    // different DB, so call the private method via the existing instance.
    (s1 as unknown as { backfillSearchIndex: () => void }).backfillSearchIndex();
    const hits = s1.db
      .prepare("SELECT kind FROM search_index WHERE search_index MATCH 'faster'")
      .all() as Array<{ kind: string }>;
    expect(hits.some((h) => h.kind === 'prompt')).toBe(true);
    s1.close();
  });

  it('turn_end is idempotent: re-running does not duplicate FTS rows', () => {
    const store = openStore();
    store.ingest(makeSessionStart('s1', '/ws'));
    store.ingest(makeTurnStart('s1', 't1'));
    const turnEnd: Event = {
      type: 'turn_end',
      turn_id: 't1',
      agent_reasoning: 'reasoning once',
      agent_final_message: 'message once',
      timestamp: 20,
    };
    store.ingest(turnEnd);
    store.ingest(turnEnd); // second time, COALESCE preserves original
    const counts = store.db
      .prepare('SELECT kind, COUNT(*) AS n FROM search_index GROUP BY kind')
      .all() as Array<{ kind: string; n: number }>;
    const byKind = Object.fromEntries(counts.map((c) => [c.kind, c.n])) as Record<string, number>;
    expect(byKind.reasoning).toBe(1);
    expect(byKind.message).toBe(1);
    store.close();
  });
});
