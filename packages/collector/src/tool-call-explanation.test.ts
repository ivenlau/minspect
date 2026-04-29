import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function seedTurn(store: Store): void {
  store.ingest({
    type: 'session_start',
    session_id: 's',
    agent: 'claude-code',
    workspace: '/ws',
    git,
    timestamp: 1,
  });
  store.ingest({
    type: 'turn_start',
    session_id: 's',
    turn_id: 't1',
    idx: 0,
    user_prompt: 'do the thing',
    git,
    timestamp: 2,
  });
}

function ingestToolCall(
  store: Store,
  tc_id: string,
  idx: number,
  tool_name: string,
  input: unknown,
): void {
  store.ingest({
    type: 'tool_call',
    session_id: 's',
    turn_id: 't1',
    tool_call_id: tc_id,
    idx,
    tool_name,
    input,
    status: 'ok',
    started_at: 10 + idx,
    ended_at: 11 + idx,
  } satisfies Event);
}

function readExplanation(store: Store, tc_id: string): string | null {
  const row = store.db.prepare('SELECT explanation FROM tool_calls WHERE id = ?').get(tc_id) as
    | { explanation: string | null }
    | undefined;
  return row?.explanation ?? null;
}

describe('onToolCallExplanation', () => {
  it('matches by exact input content and fills explanation', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    ingestToolCall(store, 'tc1', 0, 'Edit', {
      file_path: '/a.ts',
      old_string: 'foo',
      new_string: 'bar',
    });

    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Edit',
      input: { file_path: '/a.ts', old_string: 'foo', new_string: 'bar' },
      explanation: 'rename foo to bar',
      timestamp: 20,
    });

    expect(readExplanation(store, 'tc1')).toBe('rename foo to bar');
    store.close();
  });

  it('matches when object key order differs (canonical stringify)', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    ingestToolCall(store, 'tc1', 0, 'Edit', {
      new_string: 'b',
      file_path: '/a',
      old_string: 'a',
    });

    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Edit',
      input: { file_path: '/a', old_string: 'a', new_string: 'b' },
      explanation: 'reorder keys ok',
      timestamp: 20,
    });

    expect(readExplanation(store, 'tc1')).toBe('reorder keys ok');
    store.close();
  });

  it('salient-field fallback: extra noise field does not break match', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    // Stored input has `replace_all`, incoming from transcript does not.
    ingestToolCall(store, 'tc1', 0, 'Edit', {
      file_path: '/a',
      old_string: 'a',
      new_string: 'b',
      replace_all: false,
    });

    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Edit',
      input: { file_path: '/a', old_string: 'a', new_string: 'b' },
      explanation: 'fallback matched',
      timestamp: 20,
    });

    expect(readExplanation(store, 'tc1')).toBe('fallback matched');
    store.close();
  });

  it('two identical tool_calls in one turn → filled in order of arrival', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    ingestToolCall(store, 'tc1', 0, 'Bash', { command: 'ls' });
    ingestToolCall(store, 'tc2', 1, 'Bash', { command: 'ls' });

    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Bash',
      input: { command: 'ls' },
      explanation: 'first ls',
      timestamp: 20,
    });
    store.ingest({
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Bash',
      input: { command: 'ls' },
      explanation: 'second ls',
      timestamp: 21,
    });

    expect(readExplanation(store, 'tc1')).toBe('first ls');
    expect(readExplanation(store, 'tc2')).toBe('second ls');
    store.close();
  });

  it('existing explanation is not overwritten by a replay', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    ingestToolCall(store, 'tc1', 0, 'Edit', {
      file_path: '/a',
      old_string: 'a',
      new_string: 'b',
    });

    const evt: Event = {
      type: 'tool_call_explanation',
      turn_id: 't1',
      tool_name: 'Edit',
      input: { file_path: '/a', old_string: 'a', new_string: 'b' },
      explanation: 'first',
      timestamp: 20,
    };
    store.ingest(evt);
    store.ingest({ ...evt, explanation: 'second' });

    expect(readExplanation(store, 'tc1')).toBe('first');
    store.close();
  });

  it('no matching tool_call → silent no-op', () => {
    const store = new Store(':memory:');
    seedTurn(store);
    ingestToolCall(store, 'tc1', 0, 'Edit', { file_path: '/a' });

    expect(() =>
      store.ingest({
        type: 'tool_call_explanation',
        turn_id: 't1',
        tool_name: 'Write',
        input: { file_path: '/b' },
        explanation: 'orphan',
        timestamp: 20,
      }),
    ).not.toThrow();

    expect(readExplanation(store, 'tc1')).toBeNull();
    store.close();
  });

  it('migrations add tool_calls.explanation column', () => {
    const store = new Store(':memory:');
    // Assert column presence via pragma — verifies migration applied.
    const cols = store.db.prepare("PRAGMA table_info('tool_calls')").all() as Array<{
      name: string;
    }>;
    expect(cols.some((c) => c.name === 'explanation')).toBe(true);
    store.close();
  });
});
