import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event, GitState } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from './paths.js';
import { enqueueEvent, listQueued } from './queue.js';
import { sendEvent } from './transport.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function sampleEvent(id: string): Event {
  return {
    type: 'session_start',
    session_id: id,
    agent: 'claude-code',
    workspace: '/tmp/r',
    git,
    timestamp: 1,
  };
}

describe('sendEvent drain behavior', () => {
  let root: string;
  let received: Event[];
  // Per-request override: `ok` | `bad` → status 500.
  let responder: (body: Event) => 'ok' | 'bad';
  let serverClose: () => Promise<void>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'minspect-tr-'));
    received = [];
    responder = () => 'ok';
    const server = createServer((req, res) => {
      if (req.url === '/events' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c.toString();
        });
        req.on('end', () => {
          const ev = JSON.parse(body) as Event;
          const outcome = responder(ev);
          if (outcome === 'bad') {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'ingest_failed' }));
            return;
          }
          received.push(ev);
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
  });
  afterEach(async () => {
    await serverClose();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('drains a mixed queue: good events go through, bad ones move to .poison/', async () => {
    // Pre-populate queue: 2 poison, 1 good.
    enqueueEvent(sampleEvent('poison-1'), root);
    await new Promise((r) => setTimeout(r, 2));
    enqueueEvent(sampleEvent('poison-2'), root);
    await new Promise((r) => setTimeout(r, 2));
    enqueueEvent(sampleEvent('good-queued'), root);
    expect(listQueued(root)).toHaveLength(3);

    // Reject anything whose id starts with "poison-", accept others.
    responder = (ev) => ('session_id' in ev && ev.session_id.startsWith('poison-') ? 'bad' : 'ok');

    // Send a fresh event — should drain queue first, then send the new one.
    const result = await sendEvent(sampleEvent('fresh'), root);
    expect(result).toBe('sent');

    // Queue is fully drained.
    expect(listQueued(root)).toHaveLength(0);
    // Poison quarantined instead of blocking.
    const poisonDir = join(root, 'queue', '.poison');
    expect(readdirSync(poisonDir)).toHaveLength(2);
    // Collector saw the good queued event AND the fresh event.
    const ids = received.map((e) => ('session_id' in e ? e.session_id : ''));
    expect(ids).toContain('good-queued');
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('poison-1');
  });

  it('stops drain on network error and enqueues the current event', async () => {
    enqueueEvent(sampleEvent('queued-1'), root);
    // Kill the server mid-test to trigger a transient error.
    await serverClose();
    // Replace so afterEach's close is a no-op.
    serverClose = () => Promise.resolve();

    const result = await sendEvent(sampleEvent('fresh'), root);
    expect(result).toBe('queued');
    // Queued event stayed, new event was appended.
    expect(listQueued(root).length).toBeGreaterThanOrEqual(2);
    // No file moved to poison on a network error.
    const poisonDir = join(root, 'queue', '.poison');
    expect(() => readdirSync(poisonDir)).toThrow();
  });

  it('quarantines a fresh event if the collector rejects it permanently', async () => {
    responder = (ev) => ('session_id' in ev && ev.session_id === 'bad-fresh' ? 'bad' : 'ok');
    const result = await sendEvent(sampleEvent('bad-fresh'), root);
    expect(result).toBe('queued'); // "queued" = didn't reach DB, but poisoned.
    const poisonDir = join(root, 'queue', '.poison');
    expect(readdirSync(poisonDir)).toHaveLength(1);
    // Main queue empty.
    expect(listQueued(root)).toHaveLength(0);
  });
});
