import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, getDbPath } from '@minspect/collector';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runVacuum } from './vacuum';

interface TestCtx {
  root: string;
}

// Seed a DB with: 1 valid session → 1 turn → 1 edit (populates line_blame),
// plus 1 orphan line_blame row pointing at a non-existent turn.
function seedWithOrphan(root: string): void {
  const store = new Store(getDbPath(root));
  store.ingest({
    type: 'session_start',
    session_id: 's1',
    agent: 'claude-code',
    workspace: '/ws',
    git: { branch: 'main', head: 'a', dirty: false },
    timestamp: 1,
  });
  store.ingest({
    type: 'turn_start',
    session_id: 's1',
    turn_id: 't1',
    idx: 0,
    user_prompt: 'x',
    git: { branch: 'main', head: 'a', dirty: false },
    timestamp: 2,
  });
  store.ingest({
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tool_call_id: 'tc1',
    idx: 0,
    tool_name: 'Write',
    input: {},
    status: 'ok',
    file_edits: [{ file_path: 'a.ts', before_content: null, after_content: 'hi\n' }],
    started_at: 10,
    ended_at: 11,
  });
  // Inject an orphan line_blame row
  store.db
    .prepare(
      `INSERT INTO line_blame (workspace_id, file_path, line_no, content_hash, edit_id, turn_id)
       VALUES ('/ws', 'old.ts', 1, 'deadbeef', 'ghost-edit', 'ghost-turn')`,
    )
    .run();
  store.close();
}

describe('runVacuum', () => {
  let ctx: TestCtx;
  beforeEach(() => {
    ctx = { root: mkdtempSync(join(tmpdir(), 'minspect-vac-')) };
    mkdirSync(join(ctx.root, 'queue', '.poison'), { recursive: true });
  });
  afterEach(() => {
    try {
      rmSync(ctx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('dry-run: reports orphan blame + poison counts without modifying', async () => {
    seedWithOrphan(ctx.root);
    // 2 fake poison files
    writeFileSync(join(ctx.root, 'queue', '.poison', 'p1.json'), '{"type":"tool_call"}');
    writeFileSync(join(ctx.root, 'queue', '.poison', 'p2.json'), '{"type":"turn_end"}');

    const res = await runVacuum({ stateRoot: ctx.root });
    expect(res.mode).toBe('dry-run');
    expect(res.orphan_blame_rows).toBe(1);
    expect(res.poison_events).toBe(2);
    expect(res.removed.orphan_blame).toBe(0);
    expect(res.removed.poison).toBe(0);

    // Poison files still there.
    expect(readdirSync(join(ctx.root, 'queue', '.poison'))).toHaveLength(2);
  });

  it('--fix: deletes orphan blame rows', async () => {
    seedWithOrphan(ctx.root);
    const res = await runVacuum({ stateRoot: ctx.root, fix: true });
    expect(res.mode).toBe('fix');
    expect(res.removed.orphan_blame).toBe(1);

    // Verify via direct query.
    const store = new Store(getDbPath(ctx.root));
    const n = (
      store.db
        .prepare('SELECT COUNT(*) AS n FROM line_blame WHERE turn_id NOT IN (SELECT id FROM turns)')
        .get() as { n: number }
    ).n;
    expect(n).toBe(0);
    store.close();
  });

  it('--clear-poison: removes .poison/*.json files', async () => {
    writeFileSync(join(ctx.root, 'queue', '.poison', 'a.json'), '{}');
    writeFileSync(join(ctx.root, 'queue', '.poison', 'b.json'), '{}');
    const res = await runVacuum({ stateRoot: ctx.root, clearPoison: true });
    expect(res.removed.poison).toBe(2);
    expect(readdirSync(join(ctx.root, 'queue', '.poison'))).toHaveLength(0);
  });

  it('handles missing state dir gracefully', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'minspect-vac-empty-'));
    const res = await runVacuum({ stateRoot: bare });
    expect(res.orphan_blame_rows).toBe(0);
    expect(res.poison_events).toBe(0);
    rmSync(bare, { recursive: true, force: true });
  });
});
