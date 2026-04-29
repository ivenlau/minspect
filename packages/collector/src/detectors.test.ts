import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { detectBadgesForTurn } from './detectors.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function seedTurn(store: Store, edits: Array<[string, string | null, string]>, turnId = 't1') {
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
    turn_id: turnId,
    idx: 0,
    user_prompt: 'x',
    git,
    timestamp: 2,
  });
  store.ingest({
    type: 'tool_call',
    session_id: 's',
    turn_id: turnId,
    tool_call_id: `tc-${turnId}`,
    idx: 0,
    tool_name: 'Edit',
    input: {},
    status: 'ok',
    file_edits: edits.map(([file_path, before_content, after_content]) => ({
      file_path,
      before_content,
      after_content,
    })),
    started_at: 10,
    ended_at: 11,
  } satisfies Event);
}

describe('detectBadgesForTurn', () => {
  it('flags security-sensitive path', () => {
    const store = new Store(':memory:');
    seedTurn(store, [['src/auth/login.ts', 'old', 'new']]);
    const ids = detectBadgesForTurn(store, 't1').map((b) => b.id);
    expect(ids).toContain('security-sensitive-path');
    store.close();
  });

  it('flags new dependency added to package.json', () => {
    const store = new Store(':memory:');
    const before = '{"dependencies": {\n  "a": "1.0"\n}}';
    const after = '{"dependencies": {\n  "a": "1.0",\n  "b": "2.0"\n}}';
    seedTurn(store, [['package.json', before, after]]);
    const ids = detectBadgesForTurn(store, 't1').map((b) => b.id);
    expect(ids).toContain('new-dependency');
    store.close();
  });

  it('flags oversized turn (>500 new lines)', () => {
    const store = new Store(':memory:');
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
    seedTurn(store, [['src/a.ts', null, big]]);
    const ids = detectBadgesForTurn(store, 't1').map((b) => b.id);
    expect(ids).toContain('oversized-turn');
    store.close();
  });

  it('flags code + tests in same turn', () => {
    const store = new Store(':memory:');
    seedTurn(store, [
      ['src/a.ts', 'a', 'b'],
      ['src/a.test.ts', 'a', 'b'],
    ]);
    const ids = detectBadgesForTurn(store, 't1').map((b) => b.id);
    expect(ids).toContain('code-and-tests-same-turn');
    store.close();
  });

  it('flags tests-only turn as info', () => {
    const store = new Store(':memory:');
    seedTurn(store, [['src/a.test.ts', 'a', 'b']]);
    const badges = detectBadgesForTurn(store, 't1');
    const testsOnly = badges.find((b) => b.id === 'tests-only');
    expect(testsOnly?.level).toBe('info');
    store.close();
  });

  it('respects disabled config — returns empty', () => {
    const store = new Store(':memory:');
    seedTurn(store, [['src/auth/login.ts', 'old', 'new']]);
    expect(detectBadgesForTurn(store, 't1', { enabled: false })).toEqual([]);
    store.close();
  });

  it('respects custom security_globs', () => {
    const store = new Store(':memory:');
    seedTurn(store, [['custom/sensitive/file.ts', 'a', 'b']]);
    const badges = detectBadgesForTurn(store, 't1', {
      security_globs: ['custom/sensitive/'],
    });
    expect(badges.some((b) => b.id === 'security-sensitive-path')).toBe(true);
    store.close();
  });
});
