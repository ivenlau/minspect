import type { Event, GitState } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function seed(store: Store) {
  store.ingest({
    type: 'session_start',
    session_id: 's1',
    agent: 'claude-code',
    workspace: '/ws',
    git,
    timestamp: 1,
  });
  store.ingest({
    type: 'turn_start',
    session_id: 's1',
    turn_id: 't1',
    idx: 0,
    user_prompt: 'refactor login',
    git,
    timestamp: 2,
  });
  store.ingest({
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tool_call_id: 'tc1',
    idx: 0,
    tool_name: 'Edit',
    input: {},
    status: 'ok',
    file_edits: [{ file_path: 'a.ts', before_content: null, after_content: 'foo\nbar' }],
    started_at: 10,
    ended_at: 11,
  } satisfies Event);
}

describe('api', () => {
  let store: Store;
  let app: ReturnType<typeof createServer>;
  beforeEach(() => {
    store = new Store(':memory:');
    app = createServer(store);
    seed(store);
  });
  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('GET /api/sessions returns sessions newest-first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string }> };
    expect(body.sessions[0]?.id).toBe('s1');
  });

  it('GET /api/sessions/:id/files groups by file_path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/files' });
    const body = res.json() as { files: Array<{ file_path: string; edit_count: number }> };
    expect(body.files[0]?.file_path).toBe('a.ts');
    expect(body.files[0]?.edit_count).toBe(1);
  });

  it('GET /api/blame returns blame rows + turns + content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/blame?workspace=/ws&file=a.ts',
    });
    const body = res.json() as {
      blame: Array<{ line_no: number; turn_id: string }>;
      turns: Array<{ id: string; user_prompt: string }>;
      content: string;
    };
    expect(body.blame).toHaveLength(2);
    expect(body.blame[0]?.turn_id).toBe('t1');
    expect(body.turns[0]?.user_prompt).toBe('refactor login');
    expect(body.content).toBe('foo\nbar');
  });

  it('GET /api/blame missing params returns empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/blame' });
    const body = res.json() as { blame: unknown[] };
    expect(body.blame).toEqual([]);
  });

  it('GET / returns the HTML shell (or 503 if UI unbuilt)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('<html');
      expect(res.body).toContain('minspect');
    }
  });

  it('GET /api/build-info returns ui_hash + server_started_at', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/build-info' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ui_hash: string; server_started_at: number };
    // ui_hash is 12 hex chars (or 'unbuilt' in test env without dist)
    expect(typeof body.ui_hash).toBe('string');
    expect(body.ui_hash.length).toBeGreaterThan(0);
    expect(typeof body.server_started_at).toBe('number');
    expect(body.server_started_at).toBeGreaterThan(0);
  });

  it('GET /legacy/ is 404 (legacy route removed in card 32)', async () => {
    const res = await app.inject({ method: 'GET', url: '/legacy/' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/workspaces lists workspaces with aggregate counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      workspaces: Array<{
        path: string;
        session_count: number;
        total_edits: number;
        last_activity: number | null;
      }>;
    };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]?.path).toBe('/ws');
    expect(body.workspaces[0]?.session_count).toBe(1);
    expect(body.workspaces[0]?.total_edits).toBe(1);
  });

  it('GET /api/workspaces/:path/sessions returns sessions in that workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${encodeURIComponent('/ws')}/sessions`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string; agent: string }> };
    expect(body.sessions[0]?.id).toBe('s1');
    expect(body.sessions[0]?.agent).toBe('claude-code');
  });

  it('GET /api/queue-stats returns {queue, poisoned}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/queue-stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { queue: number; poisoned: number };
    expect(typeof body.queue).toBe('number');
    expect(typeof body.poisoned).toBe('number');
  });

  it('GET /api/workspaces/:path returns full workspace detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${encodeURIComponent('/ws')}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      path: string;
      session_count: number;
      turn_count: number;
      edit_count: number;
      files_touched: number;
      agents: string[];
      sessions: Array<{ id: string; turn_count: number; file_count: number }>;
      files: Array<{ file_path: string; edit_count: number }>;
    };
    expect(body.path).toBe('/ws');
    expect(body.session_count).toBe(1);
    expect(body.turn_count).toBe(1);
    expect(body.edit_count).toBe(1);
    expect(body.files_touched).toBe(1);
    expect(body.agents).toEqual(['claude-code']);
    expect(body.sessions[0]?.id).toBe('s1');
    expect(body.sessions[0]?.file_count).toBe(1);
    expect(body.files[0]?.file_path).toBe('a.ts');
  });

  it('GET /api/workspaces/:path returns 404 for unknown path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${encodeURIComponent('/nope')}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/workspaces/:path/files lists files with edit_count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${encodeURIComponent('/ws')}/files`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      files: Array<{ file_path: string; edit_count: number; touch_count: number }>;
    };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]?.file_path).toBe('a.ts');
    expect(body.files[0]?.edit_count).toBe(1);
  });

  it('GET /api/blame returns session_id per row + edits chain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/blame?workspace=/ws&file=a.ts',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      blame: Array<{ line_no: number; session_id: string; turn_id: string }>;
      turns: Array<{ id: string; session_id: string }>;
      edits: Array<{ id: string; session_id: string }>;
      chain_broken_edit_ids: string[];
    };
    // Each blame row carries session_id for color coding
    expect(body.blame[0]?.session_id).toBe('s1');
    // Turn metadata includes session_id too
    expect(body.turns[0]?.session_id).toBe('s1');
    // Edits chain has the one edit
    expect(body.edits).toHaveLength(1);
    expect(body.edits[0]?.id).toBe('tc1:0');
    // Single edit → no chain breaks possible
    expect(body.chain_broken_edit_ids).toEqual([]);
  });

  it('GET /api/dashboard caches for 20s; mutations hidden until cache expires', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    await app.inject({ method: 'GET', url: '/api/dashboard' });
    // Mutate DB — if cache is effective, the second call returns stale data.
    store.ingest({
      type: 'session_start',
      session_id: 's-codex',
      agent: 'codex',
      workspace: '/other',
      git,
      timestamp: Date.now(),
    });
    const r2 = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const b2 = r2.json() as { top_agents: Array<{ agent: string }> };
    expect(b2.top_agents.map((a) => a.agent)).not.toContain('codex');
    // Clear and confirm fresh data.
    _clearApiCache();
    const r3 = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const b3 = r3.json() as { top_agents: Array<{ agent: string }> };
    expect(b3.top_agents.map((a) => a.agent)).toContain('codex');
  });

  it('GET /api/dashboard returns activity + top lists + alerts + recent', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      activity: Array<{ day: string; edits: number }>;
      activity_total: number;
      delta_pct: number | null;
      top_workspaces: Array<{ path: string; edits: number }>;
      top_agents: Array<{ agent: string; sessions: number; pct: number }>;
      alerts: unknown[];
      recent: Array<{
        kind: 'session_start' | 'tool_call';
        session_id: string;
      }>;
    };
    // Activity series must cover 30 days, even if most are zero.
    expect(body.activity).toHaveLength(30);
    expect(typeof body.activity_total).toBe('number');
    // At least one workspace with edits from the seed.
    expect(body.top_workspaces[0]?.path).toBe('/ws');
    expect(body.top_workspaces[0]?.edits).toBe(1);
    expect(body.top_agents[0]?.agent).toBe('claude-code');
    expect(body.top_agents[0]?.pct).toBe(100);
    // Recent feed should have the session_start + tool_call from the seed.
    const kinds = body.recent.map((r) => r.kind);
    expect(kinds).toContain('session_start');
    expect(kinds).toContain('tool_call');
  });

  it('GET /api/dashboard?range=today buckets hourly (up to current hour)', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?range=today' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { activity: Array<{ day: string; edits: number }> };
    // 1..24 hour buckets — not a fixed count because it trims to current hour.
    expect(body.activity.length).toBeGreaterThan(0);
    expect(body.activity.length).toBeLessThanOrEqual(24);
    // Hour bucket key: "YYYY-MM-DD HH"
    for (const a of body.activity) expect(a.day).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}$/);
  });

  it('GET /api/dashboard?range=week returns 7 daily buckets', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?range=week' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { activity: Array<{ day: string; edits: number }> };
    expect(body.activity).toHaveLength(7);
    for (const a of body.activity) expect(a.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('GET /api/dashboard?range=year returns 12 monthly buckets', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?range=year' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { activity: Array<{ day: string; edits: number }> };
    expect(body.activity).toHaveLength(12);
    for (const a of body.activity) expect(a.day).toMatch(/^\d{4}-\d{2}$/);
  });

  it('GET /api/dashboard?range=bogus falls back to 30d', async () => {
    const { _clearApiCache } = await import('./api.js');
    _clearApiCache();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?range=forever' });
    const body = res.json() as { activity: unknown[] };
    expect(body.activity).toHaveLength(30);
  });

  it('GET /api/blobs/:hash returns the blob content', async () => {
    const afterHash = store.db
      .prepare('SELECT after_hash FROM edits WHERE id = ?')
      .get('tc1:0') as { after_hash: string };
    const res = await app.inject({ method: 'GET', url: `/api/blobs/${afterHash.after_hash}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('foo\nbar');
    expect(res.headers.etag).toBe(afterHash.after_hash);
  });

  it('GET /api/blobs/:hash rejects malformed hash with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/blobs/not-a-sha' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/blobs/:hash returns 404 for missing blob', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/blobs/${'0'.repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/revert/plan?turn= returns per-file plan with before/after hashes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/revert/plan?turn=t1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      target_kind: string;
      source_agent: string;
      files: Array<{ file_path: string; before_hash: string | null; kind: string }>;
      warnings: { codex_source: boolean };
    };
    expect(body.target_kind).toBe('turn');
    expect(body.source_agent).toBe('claude-code');
    expect(body.files).toHaveLength(1);
    expect(body.files[0]?.file_path).toBe('a.ts');
    expect(body.files[0]?.kind).toBe('delete'); // before_hash is null (AI created it)
    expect(body.warnings.codex_source).toBe(false);
  });

  it('GET /api/revert/plan flags codex_source for Codex-imported sessions', async () => {
    // Seed a parallel Codex session touching a different file so we don't
    // collide with the default claude-code seed.
    store.ingest({
      type: 'session_start',
      session_id: 'cx1',
      agent: 'codex',
      workspace: '/ws',
      git,
      timestamp: 100,
    });
    store.ingest({
      type: 'turn_start',
      session_id: 'cx1',
      turn_id: 'ct1',
      idx: 0,
      user_prompt: 'codex prompt',
      git,
      timestamp: 101,
    });
    store.ingest({
      type: 'tool_call',
      session_id: 'cx1',
      turn_id: 'ct1',
      tool_call_id: 'cxtc1',
      idx: 0,
      tool_name: 'apply_patch',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: 'codex.ts', before_content: 'old', after_content: 'new' }],
      started_at: 110,
      ended_at: 111,
    } satisfies Event);
    const res = await app.inject({ method: 'GET', url: '/api/revert/plan?turn=ct1' });
    const body = res.json() as { warnings: { codex_source: boolean } };
    expect(body.warnings.codex_source).toBe(true);
  });

  it('GET /api/revert/plan flags later_edits_will_be_lost when later edits exist', async () => {
    // Seed a second turn that edits the same file.
    store.ingest({
      type: 'turn_start',
      session_id: 's1',
      turn_id: 't2',
      idx: 1,
      user_prompt: 'second',
      git,
      timestamp: 20,
    });
    store.ingest({
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't2',
      tool_call_id: 'tc2',
      idx: 0,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: 'a.ts', before_content: 'foo\nbar', after_content: 'foo\nbaz' }],
      started_at: 30,
      ended_at: 31,
    } satisfies Event);
    const res = await app.inject({ method: 'GET', url: '/api/revert/plan?turn=t1' });
    const body = res.json() as {
      warnings: { later_edits_will_be_lost: Array<{ file_path: string }> };
    };
    expect(body.warnings.later_edits_will_be_lost).toHaveLength(1);
    expect(body.warnings.later_edits_will_be_lost[0]?.file_path).toBe('a.ts');
  });

  it('GET /api/revert/plan returns 400 when neither or both of turn/edit are given', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/revert/plan' });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/api/revert/plan?turn=t1&edit=tc1:0',
    });
    expect(r2.statusCode).toBe(400);
  });

  it('GET /api/revert/plan returns 404 for unknown turn', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/revert/plan?turn=nope' });
    expect(res.statusCode).toBe(404);
  });

  // Card 33: cross-session search via FTS5.
  it('GET /api/search returns fts_available=true for a valid query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=login' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      fts_available: boolean;
      results: Array<{ kind: string; source_id: string; snippet: string }>;
    };
    expect(body.fts_available).toBe(true);
    // `refactor login` prompt was seeded; also file_path a.ts wouldn't match.
    const prompts = body.results.filter((r) => r.kind === 'prompt');
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]?.source_id).toBe('t1');
    expect(prompts[0]?.snippet.toLowerCase()).toContain('login');
  });

  it('GET /api/search with empty q returns empty results without hitting FTS', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { fts_available: boolean; results: unknown[] };
    expect(body.fts_available).toBe(true);
    expect(body.results).toHaveLength(0);
  });

  it('GET /api/search sanitises punctuation and AND-concatenates tokens', async () => {
    // Query with operators & punctuation should still match `refactor login`.
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('"refactor" AND login!')}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      query: string;
      results: Array<{ kind: string; source_id: string }>;
    };
    // Tokens are prefix-matched with `*` — see api.ts for the exact rewrite.
    expect(body.query).toContain('refactor');
    expect(body.query).toContain('login');
    expect(body.results.some((r) => r.source_id === 't1')).toBe(true);
  });
});
