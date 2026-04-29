import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { listQueued } from '../queue.js';
import { readOpenCodeState } from '../session-state-opencode.js';
import { runCaptureOpenCode } from './capture-opencode.js';

describe('runCaptureOpenCode', () => {
  let root: string;
  let received: Event[];
  let serverClose: (() => Promise<void>) | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-oco-'));
    received = [];
    serverClose = null;
  });

  afterEach(async () => {
    if (serverClose) await serverClose();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function startStubCollector(): Promise<void> {
    const server = createServer((req, res) => {
      if (req.url === '/events' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c.toString();
        });
        req.on('end', () => {
          received.push(JSON.parse(body) as Event);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    serverClose = () => new Promise<void>((resolve) => server.close(() => resolve()));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      getStateFilePath(root),
      JSON.stringify({ port: addr.port, pid: process.pid, started_at: Date.now() }),
    );
  }

  it('session.created envelope → POSTs session_start and persists state', async () => {
    await startStubCollector();
    const result = await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'session.created',
          properties: {
            info: { id: 'sess-oc-1', directory: '/ws/oc', time: { created: 1000 } },
          },
        },
        timestamp: 1000,
      },
    });
    expect(result?.events).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'session_start',
      session_id: 'sess-oc-1',
      agent: 'opencode',
      workspace: '/ws/oc',
    });
    // State was written.
    const st = readOpenCodeState('sess-oc-1', root);
    expect(st.session_id).toBe('sess-oc-1');
    expect(st.workspace).toBe('/ws/oc');
  });

  it('collector offline → events land in disk queue', async () => {
    // Do NOT start a collector — writing state file with a port that nobody
    // is listening on forces transport to enqueue.
    mkdirSync(root, { recursive: true });
    writeFileSync(
      getStateFilePath(root),
      JSON.stringify({ port: 1, pid: process.pid, started_at: Date.now() }),
    );
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'session.created',
          properties: { info: { id: 'sess-oc-2', directory: '/ws' } },
        },
        timestamp: 1000,
      },
    });
    expect(listQueued(root).length).toBeGreaterThan(0);
  });

  it('concurrent captures on same session are serialized (no lost state updates)', async () => {
    await startStubCollector();

    // First envelope primes session + pending user turn.
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'session.created',
          properties: { info: { id: 'race', directory: '/ws' } },
        },
        timestamp: 1000,
      },
    });
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'message.updated',
          properties: {
            info: { id: 'u1', sessionID: 'race', role: 'user', time: { created: 1100 } },
          },
        },
        timestamp: 1100,
      },
    });

    // 10 parallel captures, each appending a different reasoning part.
    const tasks = Array.from({ length: 10 }, (_, i) =>
      runCaptureOpenCode({
        stateRoot: root,
        rawEnvelope: {
          hookName: 'event',
          payload: {
            type: 'message.part.updated',
            properties: {
              part: {
                id: `rp-${i}`,
                sessionID: 'race',
                messageID: 'a1',
                type: 'reasoning',
                text: `reasoning-${i}`,
                time: { start: 1200 + i, end: 1250 + i },
              },
            },
          },
          timestamp: 1250 + i,
        },
      }),
    );
    await Promise.all(tasks);

    // After all writes settle, state should contain every reasoning part —
    // no losses from read-modify-write races.
    const { readOpenCodeState } = await import('../session-state-opencode.js');
    const st = readOpenCodeState('race', root);
    expect(Object.keys(st.reasoning_by_part_id).length).toBe(10);
  });

  it('malformed envelope (non-event hookName) returns empty without throwing', async () => {
    await startStubCollector();
    const result = await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: { hookName: 'bogus', payload: {}, timestamp: 1 },
    });
    // extractSessionId → null, parseOpenCodeEnvelope → warning, no events
    expect(result?.events ?? 0).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('full user→tool→assistant flow produces session_start/turn_start/tool_call/turn_end', async () => {
    await startStubCollector();

    // session.created
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'session.created',
          properties: { info: { id: 's1', directory: '/ws' } },
        },
        timestamp: 1000,
      },
    });
    // user message
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'message.updated',
          properties: {
            info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1100 } },
          },
        },
        timestamp: 1100,
      },
    });
    // tool (write) completes
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 's1',
              messageID: 'a1',
              type: 'tool',
              callID: 'c1',
              tool: 'write',
              state: {
                status: 'completed',
                input: { file_path: 'a.ts', content: 'x\n' },
                output: 'ok',
                title: 'write a.ts',
                metadata: {},
                time: { start: 1200, end: 1250 },
              },
            },
          },
        },
        timestamp: 1250,
      },
    });
    // assistant completes (doesn't yet trigger turn_end — multi-step capable)
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'a1',
              sessionID: 's1',
              role: 'assistant',
              time: { created: 1150, completed: 1300 },
            },
          },
        },
        timestamp: 1300,
      },
    });
    // session.idle is what actually emits turn_end in the new model.
    await runCaptureOpenCode({
      stateRoot: root,
      rawEnvelope: {
        hookName: 'event',
        payload: { type: 'session.idle', properties: { sessionID: 's1' } },
        timestamp: 1400,
      },
    });
    // Allow the in-process POSTs to settle (they use fetch which resolves on
    // next microtask after the http server write).
    await new Promise((r) => setTimeout(r, 20));
    const types = received.map((e) => e.type);
    expect(types).toEqual(['session_start', 'turn_start', 'tool_call', 'turn_end']);
  });
});
