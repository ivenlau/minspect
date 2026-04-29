import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { linkCommit } from './commit-link.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function seed(store: Store, workspace: string, filePath: string, editIdPrefix: string, t: number) {
  store.ingest({
    type: 'session_start',
    session_id: `s-${editIdPrefix}`,
    agent: 'claude-code',
    workspace,
    git,
    timestamp: t,
  });
  store.ingest({
    type: 'turn_start',
    session_id: `s-${editIdPrefix}`,
    turn_id: `t-${editIdPrefix}`,
    idx: 0,
    user_prompt: 'change',
    git,
    timestamp: t,
  });
  store.ingest({
    type: 'tool_call',
    session_id: `s-${editIdPrefix}`,
    turn_id: `t-${editIdPrefix}`,
    tool_call_id: `tc-${editIdPrefix}`,
    idx: 0,
    tool_name: 'Edit',
    input: {},
    status: 'ok',
    file_edits: [{ file_path: filePath, before_content: 'o', after_content: 'n' }],
    started_at: t,
    ended_at: t + 1,
  } satisfies Event);
}

describe('linkCommit', () => {
  it('links recent edits for matched files; excludes unrelated files', () => {
    const store = new Store(':memory:');
    const ws = '/ws';
    const now = Date.now();
    seed(store, ws, 'a.ts', 'a', now - 1_000);
    seed(store, ws, 'b.ts', 'b', now - 1_000);
    seed(store, ws, 'c.ts', 'c', now - 1_000); // unrelated

    const res = linkCommit(store, {
      commit_sha: 'abc123',
      workspace: ws,
      changed_files: ['a.ts', 'b.ts'],
    });
    expect(res.linked).toBe(2);
    const rows = store.db
      .prepare('SELECT edit_id FROM commit_links WHERE commit_sha=?')
      .all('abc123') as Array<{ edit_id: string }>;
    expect(rows.map((r) => r.edit_id).sort()).toEqual(['tc-a:0', 'tc-b:0']);
    store.close();
  });

  it('respects time_window_ms; ignores edits older than window', () => {
    const store = new Store(':memory:');
    const ws = '/ws';
    const now = Date.now();
    seed(store, ws, 'a.ts', 'old', now - 48 * 60 * 60 * 1000); // 48h ago

    const res = linkCommit(store, {
      commit_sha: 'sha',
      workspace: ws,
      changed_files: ['a.ts'],
      time_window_ms: 24 * 60 * 60 * 1000,
    });
    expect(res.linked).toBe(0);
    store.close();
  });

  it('no-op for empty changed_files', () => {
    const store = new Store(':memory:');
    const res = linkCommit(store, {
      commit_sha: 'x',
      workspace: '/ws',
      changed_files: [],
    });
    expect(res.linked).toBe(0);
    store.close();
  });

  it('idempotent — calling twice with same sha does not dup', () => {
    const store = new Store(':memory:');
    const ws = '/ws';
    seed(store, ws, 'a.ts', 'a', Date.now() - 100);
    linkCommit(store, { commit_sha: 'sha', workspace: ws, changed_files: ['a.ts'] });
    const res = linkCommit(store, {
      commit_sha: 'sha',
      workspace: ws,
      changed_files: ['a.ts'],
    });
    expect(res.linked).toBe(0); // already linked, excluded by NOT IN
    const count = store.db
      .prepare('SELECT COUNT(*) AS c FROM commit_links WHERE commit_sha=?')
      .get('sha') as { c: number };
    expect(count.c).toBe(1);
    store.close();
  });

  // Regression tests for the Windows cross-convention bug: Claude Code hook
  // stores OS-native paths (backslashes); git diff returns repo-relative
  // forward-slash paths. Commit-link has to bridge both.
  it('Windows: absolute backslash edit path matches git relative forward-slash', () => {
    const store = new Store(':memory:');
    const ws = 'C:\\Users\\me\\repo';
    const abs = 'C:\\Users\\me\\repo\\src\\api.ts';
    seed(store, ws, abs, 'win1', Date.now() - 100);
    const res = linkCommit(store, {
      commit_sha: 'win-sha',
      workspace: 'C:/Users/me/repo', // git form
      changed_files: ['src/api.ts'], // git-relative form
    });
    expect(res.linked).toBe(1);
    store.close();
  });

  it('Windows: git-form workspace matches backslash stored workspace', () => {
    const store = new Store(':memory:');
    const ws = 'C:\\a\\b';
    seed(store, ws, 'C:\\a\\b\\x.ts', 'win2', Date.now() - 100);
    const res = linkCommit(store, {
      commit_sha: 'sha',
      workspace: 'C:/a/b',
      changed_files: ['x.ts'],
    });
    expect(res.linked).toBe(1);
    store.close();
  });

  it('stores confidence (default 1.0)', () => {
    const store = new Store(':memory:');
    const ws = '/ws';
    seed(store, ws, 'a.ts', 'a', Date.now() - 100);
    linkCommit(store, {
      commit_sha: 'sha',
      workspace: ws,
      changed_files: ['a.ts'],
      confidence: 0.5,
    });
    const row = store.db
      .prepare('SELECT confidence FROM commit_links WHERE commit_sha=?')
      .get('sha') as { confidence: number };
    expect(row.confidence).toBe(0.5);
    store.close();
  });
});
