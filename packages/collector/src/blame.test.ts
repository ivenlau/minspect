import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { computeHunks, propagateBlame } from './blame.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

describe('computeHunks', () => {
  it('new file → single hunk covering whole file', () => {
    const h = computeHunks('e1', null, 'line a\nline b\n');
    expect(h).toHaveLength(1);
    expect(h[0]?.old_start).toBeNull();
    expect(h[0]?.new_count).toBeGreaterThan(0);
  });

  it('insertion produces a hunk with +-only lines', () => {
    const before = ['a', 'b', 'c'].join('\n');
    const after = ['a', 'x', 'y', 'b', 'c'].join('\n');
    const h = computeHunks('e1', before, after);
    expect(h.length).toBeGreaterThan(0);
    const newTexts = h.map((x) => x.new_text ?? '').join('\n');
    expect(newTexts).toContain('x');
    expect(newTexts).toContain('y');
  });

  it('deletion produces a hunk with --only lines', () => {
    const before = ['a', 'b', 'c'].join('\n');
    const after = ['a', 'c'].join('\n');
    const h = computeHunks('e1', before, after);
    expect(h.length).toBeGreaterThan(0);
    const oldTexts = h.map((x) => x.old_text ?? '').join('\n');
    expect(oldTexts).toContain('b');
  });
});

describe('propagateBlame', () => {
  it('inheritance: unchanged lines keep prior edit_id/turn_id', () => {
    const prior = [
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 1,
        content_hash: 'h1',
        edit_id: 'e0',
        turn_id: 't0',
      },
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 2,
        content_hash: 'h2',
        edit_id: 'e0',
        turn_id: 't0',
      },
    ];
    const result = propagateBlame({
      workspace_id: 'w',
      file_path: 'a.ts',
      prior_blame: prior,
      before_lines: ['a', 'b'],
      after_lines: ['a', 'b', 'c'],
      edit_id: 'e1',
      turn_id: 't1',
    });
    expect(result).toHaveLength(3);
    expect(result[0]?.edit_id).toBe('e0'); // inherited
    expect(result[1]?.edit_id).toBe('e0'); // inherited
    expect(result[2]?.edit_id).toBe('e1'); // new
  });

  it('insertion in the middle: prior lines shift correctly', () => {
    const prior = [
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 1,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 2,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 3,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
    ];
    const result = propagateBlame({
      workspace_id: 'w',
      file_path: 'a.ts',
      prior_blame: prior,
      before_lines: ['a', 'b', 'c'],
      after_lines: ['a', 'NEW1', 'NEW2', 'b', 'c'],
      edit_id: 'e1',
      turn_id: 't1',
    });
    expect(result.map((r) => r.edit_id)).toEqual(['e0', 'e1', 'e1', 'e0', 'e0']);
    expect(result.map((r) => r.line_no)).toEqual([1, 2, 3, 4, 5]);
  });

  it('deletion: remaining lines retain prior blame', () => {
    const prior = [
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 1,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 2,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
      {
        workspace_id: 'w',
        file_path: 'a.ts',
        line_no: 3,
        content_hash: 'h',
        edit_id: 'e0',
        turn_id: 't0',
      },
    ];
    const result = propagateBlame({
      workspace_id: 'w',
      file_path: 'a.ts',
      prior_blame: prior,
      before_lines: ['a', 'b', 'c'],
      after_lines: ['a', 'c'],
      edit_id: 'e1',
      turn_id: 't1',
    });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.edit_id === 'e0')).toBe(true);
  });

  it('broken chain (prior_blame=null): all lines attributed to current edit', () => {
    const result = propagateBlame({
      workspace_id: 'w',
      file_path: 'a.ts',
      prior_blame: null,
      before_lines: ['a', 'b'],
      after_lines: ['a', 'b', 'c'],
      edit_id: 'e1',
      turn_id: 't1',
    });
    expect(result.map((r) => r.edit_id)).toEqual(['e1', 'e1', 'e1']);
  });
});

describe('updateBlameForEdit (through Store)', () => {
  function seedSession(store: Store, workspace: string) {
    store.ingest({
      type: 'session_start',
      session_id: 's',
      agent: 'claude-code',
      workspace,
      git,
      timestamp: 1,
    });
    store.ingest({
      type: 'turn_start',
      session_id: 's',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'first',
      git,
      timestamp: 2,
    });
  }

  function toolCall(
    sessionTurn: { session: string; turn: string; tc: string; idx: number },
    file: string,
    before: string | null,
    after: string,
    t: number,
  ): Event {
    return {
      type: 'tool_call',
      session_id: sessionTurn.session,
      turn_id: sessionTurn.turn,
      tool_call_id: sessionTurn.tc,
      idx: sessionTurn.idx,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: file, before_content: before, after_content: after }],
      started_at: t,
      ended_at: t + 1,
    };
  }

  it('first edit creates line_blame rows for every after line', () => {
    const store = new Store(':memory:');
    seedSession(store, '/ws');
    store.ingest(
      toolCall({ session: 's', turn: 't1', tc: 'tc1', idx: 0 }, 'a.ts', null, 'one\ntwo', 10),
    );
    const rows = store.db
      .prepare('SELECT line_no, edit_id FROM line_blame ORDER BY line_no')
      .all() as Array<{ line_no: number; edit_id: string }>;
    expect(rows.map((r) => r.line_no)).toEqual([1, 2]);
    expect(new Set(rows.map((r) => r.edit_id))).toEqual(new Set(['tc1:0']));
    store.close();
  });

  it('second edit inheriting chain: unchanged lines keep prior edit_id', () => {
    const store = new Store(':memory:');
    seedSession(store, '/ws');
    store.ingest(
      toolCall({ session: 's', turn: 't1', tc: 'tc1', idx: 0 }, 'a.ts', null, 'a\nb', 10),
    );
    // Second turn
    store.ingest({
      type: 'turn_start',
      session_id: 's',
      turn_id: 't2',
      idx: 1,
      user_prompt: 'second',
      git,
      timestamp: 11,
    });
    store.ingest(
      toolCall({ session: 's', turn: 't2', tc: 'tc2', idx: 0 }, 'a.ts', 'a\nb', 'a\nb\nc', 12),
    );
    const rows = store.db
      .prepare('SELECT line_no, edit_id FROM line_blame ORDER BY line_no')
      .all() as Array<{ line_no: number; edit_id: string }>;
    expect(rows.map((r) => r.edit_id)).toEqual(['tc1:0', 'tc1:0', 'tc2:0']);
    store.close();
  });

  it('broken chain: before_content mismatches prior after → all lines attributed to current edit', () => {
    const store = new Store(':memory:');
    seedSession(store, '/ws');
    // Edit 1 sets file to "a\nb"
    store.ingest(
      toolCall({ session: 's', turn: 't1', tc: 'tc1', idx: 0 }, 'a.ts', null, 'a\nb', 10),
    );
    store.ingest({
      type: 'turn_start',
      session_id: 's',
      turn_id: 't2',
      idx: 1,
      user_prompt: 'second',
      git,
      timestamp: 11,
    });
    // Edit 2 claims before_content = "USER_EDITED\nb" — user manually changed line 1
    store.ingest(
      toolCall(
        { session: 's', turn: 't2', tc: 'tc2', idx: 0 },
        'a.ts',
        'USER_EDITED\nb',
        'USER_EDITED\nNEW',
        12,
      ),
    );
    const rows = store.db
      .prepare('SELECT line_no, edit_id FROM line_blame ORDER BY line_no')
      .all() as Array<{ line_no: number; edit_id: string }>;
    // Both lines attributed to the new edit since chain is broken.
    expect(rows.every((r) => r.edit_id === 'tc2:0')).toBe(true);
    store.close();
  });

  it('hunks are recomputed per edit (not a single whole-file hunk)', () => {
    const store = new Store(':memory:');
    seedSession(store, '/ws');
    store.ingest(
      toolCall(
        { session: 's', turn: 't1', tc: 'tc1', idx: 0 },
        'a.ts',
        'a\nb\nc\nd\ne',
        'a\nB2\nc\nD2\ne',
        10,
      ),
    );
    const hunks = store.db.prepare('SELECT * FROM hunks ORDER BY id').all() as Array<{
      new_count: number;
      old_count: number;
    }>;
    // 2 separate changes at line 2 and line 4 → 2 hunks.
    expect(hunks.length).toBe(2);
    store.close();
  });
});
