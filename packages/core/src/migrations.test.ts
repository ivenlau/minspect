import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INITIAL_SCHEMA_SQL, applyMigrations, hasSearchIndex } from './migrations.js';

// Vite 5 strips `node:` prefix during static analysis and fails to resolve
// `node:sqlite` (added in Node 22.5). createRequire sidesteps that — Node's
// runtime happily loads the built-in.
const require_ = createRequire(import.meta.url);
const { DatabaseSync } = require_('node:sqlite') as typeof import('node:sqlite');

const EXPECTED_TABLES = [
  'workspaces',
  'sessions',
  'turns',
  'tool_calls',
  'edits',
  'blobs',
  'hunks',
  'line_blame',
  'ast_nodes',
  'edit_ast_impact',
  'commit_links',
];

const EXPECTED_INDEXES = ['idx_edits_file', 'idx_edits_session', 'idx_blame_file'];

describe('applyMigrations', () => {
  it('creates every expected table and index on a fresh in-memory db', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of EXPECTED_TABLES) expect(tables).toContain(t);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const i of EXPECTED_INDEXES) expect(indexes).toContain(i);
  });

  it('is idempotent (second apply on same db is a no-op)', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
  });
});

describe('INITIAL_SCHEMA_SQL', () => {
  it('matches schema.sql byte-for-byte (prevents drift)', () => {
    const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
    const fromFile = readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');
    expect(INITIAL_SCHEMA_SQL).toBe(fromFile);
  });
});

describe('FTS5 search_index (card 33)', () => {
  it('is created when FTS5 is available and hasSearchIndex reports true', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db);
    // node:sqlite ships FTS5 by default, so we expect it on every CI box.
    expect(hasSearchIndex(db)).toBe(true);
    // MATCH works against an empty index without throwing — shape check only.
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM search_index WHERE search_index MATCH 'foo'")
      .all();
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('FTS5 insert + MATCH returns bm25-sorted hits', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db);
    const ins = db.prepare(
      'INSERT INTO search_index (kind, source_id, session_id, workspace_id, content) VALUES (?, ?, ?, ?, ?)',
    );
    ins.run('prompt', 't1', 's1', '/w', 'fix the login bug in auth middleware');
    ins.run('prompt', 't2', 's1', '/w', 'add dark mode toggle');
    ins.run('explanation', 'tc1', 's1', '/w', 'refactor login helper');

    const hits = db
      .prepare(
        `SELECT kind, source_id FROM search_index
         WHERE search_index MATCH ?
         ORDER BY bm25(search_index)`,
      )
      .all('login');
    expect(hits.length).toBe(2);
    const ids = (hits as Array<{ source_id: string }>).map((r) => r.source_id);
    expect(ids).toContain('t1');
    expect(ids).toContain('tc1');
    expect(ids).not.toContain('t2');
  });
});
