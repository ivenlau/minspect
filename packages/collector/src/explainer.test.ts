import type { Event, GitState } from '@minspect/core';
import { describe, expect, it, vi } from 'vitest';
import type { ExplainerConfig } from './explainer-config.js';
import { type AnthropicLike, runExplainer } from './explainer.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function seedHunk(store: Store): string {
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
    user_prompt: 'rename x to y',
    git,
    timestamp: 2,
  });
  store.ingest({
    type: 'tool_call',
    session_id: 's',
    turn_id: 't1',
    tool_call_id: 'tc1',
    idx: 0,
    tool_name: 'Edit',
    input: {},
    status: 'ok',
    file_edits: [
      { file_path: 'a.ts', before_content: 'const x = 1', after_content: 'const y = 1' },
    ],
    started_at: 10,
    ended_at: 11,
  } satisfies Event);
  const hunk = store.db.prepare('SELECT id FROM hunks LIMIT 1').get() as { id: string };
  return hunk.id;
}

const config: ExplainerConfig = {
  enabled: true,
  model: 'claude-haiku-4-5',
  api_key_env: 'ANTHROPIC_API_KEY',
  max_lines: 200,
  daily_usd_cap: null,
  blocklist_globs: [],
};

describe('runExplainer', () => {
  it('enqueues hunks on ingest, then processes queue and writes explanation', async () => {
    const store = new Store(':memory:');
    seedHunk(store);

    const queued = store.db.prepare('SELECT COUNT(*) AS c FROM explain_queue').get() as {
      c: number;
    };
    expect(queued.c).toBe(1);

    const mock: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Rename variable x to y for consistency.' }],
          model: 'claude-haiku-4-5',
        }),
      },
    };

    const result = await runExplainer(store, { config, anthropic: mock });
    expect(result.processed).toBe(1);
    expect(result.cached).toBe(0);

    const hunk = store.db.prepare('SELECT explanation, explanation_model FROM hunks').get() as {
      explanation: string;
      explanation_model: string;
    };
    expect(hunk.explanation).toBe('Rename variable x to y for consistency.');
    expect(hunk.explanation_model).toBe('claude-haiku-4-5');

    const left = store.db.prepare('SELECT COUNT(*) AS c FROM explain_queue').get() as { c: number };
    expect(left.c).toBe(0);
    store.close();
  });

  it('hits the in-DB cache on a second identical call; no API call', async () => {
    const store = new Store(':memory:');
    seedHunk(store);
    const mock: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'cached answer' }],
          model: 'claude-haiku-4-5',
        }),
      },
    };
    await runExplainer(store, { config, anthropic: mock });
    expect(mock.messages.create).toHaveBeenCalledTimes(1);

    // Re-enqueue the same hunk; should hit cache, no new API call.
    const hunkId = (store.db.prepare('SELECT id FROM hunks').get() as { id: string }).id;
    store.db
      .prepare('INSERT INTO explain_queue (hunk_id, enqueued_at, attempts) VALUES (?, ?, 0)')
      .run(hunkId, Date.now());

    const result = await runExplainer(store, { config, anthropic: mock });
    expect(result.cached).toBe(1);
    expect(mock.messages.create).toHaveBeenCalledTimes(1); // no additional call
    store.close();
  });

  it('API error increments attempts; drops after 3 failures', async () => {
    const store = new Store(':memory:');
    seedHunk(store);
    const mock: AnthropicLike = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('rate_limit')),
      },
    };

    await runExplainer(store, { config, anthropic: mock });
    await runExplainer(store, { config, anthropic: mock });
    await runExplainer(store, { config, anthropic: mock });

    const queued = store.db.prepare('SELECT COUNT(*) AS c FROM explain_queue').get() as {
      c: number;
    };
    expect(queued.c).toBe(0); // dropped after 3 attempts
    store.close();
  });

  it('disabled config returns early without any DB touch', async () => {
    const store = new Store(':memory:');
    seedHunk(store);
    const mock: AnthropicLike = { messages: { create: vi.fn() } };
    const result = await runExplainer(store, {
      config: { ...config, enabled: false },
      anthropic: mock,
    });
    expect(result).toEqual({ processed: 0, cached: 0, errors: 0 });
    expect(mock.messages.create).not.toHaveBeenCalled();
    store.close();
  });

  it('sends system prompt with cache_control=ephemeral', async () => {
    const store = new Store(':memory:');
    seedHunk(store);
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-haiku-4-5',
    });
    const mock: AnthropicLike = { messages: { create } };
    await runExplainer(store, { config, anthropic: mock });
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0]?.[0] as {
      model: string;
      system: Array<{ cache_control: { type: string } }>;
    };
    expect(args.model).toBe('claude-haiku-4-5');
    expect(args.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    store.close();
  });
});
