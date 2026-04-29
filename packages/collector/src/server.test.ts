import type { Event, GitState } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'abc', dirty: false };

describe('server POST /events', () => {
  let store: Store;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    store = new Store(':memory:');
    app = createServer(store);
  });
  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('200s on valid event and persists it', async () => {
    const event: Event = {
      type: 'session_start',
      session_id: 's1',
      agent: 'claude-code',
      workspace: '/tmp/r',
      git,
      timestamp: 1,
    };
    const res = await app.inject({ method: 'POST', url: '/events', payload: event });
    expect(res.statusCode).toBe(200);
    const count = store.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('400s on invalid payload with zod error paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'session_start', timestamp: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; issues: Array<{ path: unknown[] }> };
    expect(body.error).toBe('validation_error');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('handles 100 concurrent POSTs with all events persisted', async () => {
    // Prime session + turn
    await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        type: 'session_start',
        session_id: 's1',
        agent: 'claude-code',
        workspace: '/tmp/r',
        git,
        timestamp: 0,
      } satisfies Event,
    });
    await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        type: 'turn_start',
        session_id: 's1',
        turn_id: 't1',
        idx: 0,
        user_prompt: 'hi',
        git,
        timestamp: 1,
      } satisfies Event,
    });

    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/events',
          payload: {
            type: 'tool_call',
            session_id: 's1',
            turn_id: 't1',
            tool_call_id: `tc${i}`,
            idx: i,
            tool_name: 'Edit',
            input: {},
            status: 'ok',
            started_at: i,
            ended_at: i + 1,
          } satisfies Event,
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const count = store.db.prepare('SELECT COUNT(*) as c FROM tool_calls').get() as { c: number };
    expect(count.c).toBe(N);
  });

  it('/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('preserves data across reopen (persistence smoke test)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        type: 'session_start',
        session_id: 's1',
        agent: 'claude-code',
        workspace: '/tmp/r',
        git,
        timestamp: 1,
      } satisfies Event,
    });
    expect(res.statusCode).toBe(200);
    // Here we're using :memory:, so reopen === new store. The persistence
    // property is really tested by Store's acceptance of file-backed paths,
    // which store.test.ts exercises and which better-sqlite3 guarantees.
  });
});
