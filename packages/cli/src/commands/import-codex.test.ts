import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { parseDuration, runImportCodex, runImportCodexAll } from './import-codex.js';

const FIXTURE = [
  {
    timestamp: '2026-04-01T10:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'codex-sess-xyz',
      timestamp: '2026-04-01T10:00:00.000Z',
      cwd: '/ws/demo',
      cli_version: '0.104.0',
    },
  },
  {
    timestamp: '2026-04-01T10:00:01.000Z',
    type: 'event_msg',
    payload: { type: 'task_started', turn_id: 'turn-1' },
  },
  {
    timestamp: '2026-04-01T10:00:01.100Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'hi' },
  },
  {
    timestamp: '2026-04-01T10:00:02.000Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'Hi.' },
  },
  {
    timestamp: '2026-04-01T10:00:02.100Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn-1' },
  },
]
  .map((o) => JSON.stringify(o))
  .join('\n');

describe('runImportCodex', () => {
  let root: string;
  let fixtureFile: string;
  let received: Event[];
  let serverClose: () => Promise<void>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'minspect-import-'));
    received = [];
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
    fixtureFile = join(root, 'rollout-2026-04-01T10-00-00-codex-sess-xyz.jsonl');
    writeFileSync(fixtureFile, `${FIXTURE}\n`);
  });

  afterEach(async () => {
    await serverClose();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('imports a Codex session log and POSTs events to the collector', async () => {
    const res = await runImportCodex({ session: fixtureFile, stateRoot: root });
    expect(res.session_id).toBe('codex-sess-xyz');
    expect(res.events_sent).toBeGreaterThan(0);
    const types = received.map((e) => e.type);
    expect(types).toContain('session_start');
    expect(types).toContain('turn_start');
    expect(types).toContain('turn_end');
    const start = received.find((e) => e.type === 'session_start');
    if (!start || start.type !== 'session_start') throw new Error('session_start missing');
    expect(start.agent).toBe('codex');
  });

  it('accepts --latest by scanning the dir for newest rollout file', async () => {
    const res = await runImportCodex({ latest: true, dir: root, stateRoot: root });
    expect(res.file).toBe(fixtureFile);
  });

  it('raises a clear error when no session specified and no --latest', async () => {
    await expect(
      runImportCodex({ dir: join(tmpdir(), 'non-existent-codex'), stateRoot: root }),
    ).rejects.toThrow(/no rollout/);
  });

  it('--all + --since filters by mtime window', async () => {
    // Write a second rollout file with an mtime well outside the window.
    const oldFile = join(root, 'rollout-OLD.jsonl');
    writeFileSync(oldFile, FIXTURE);
    // Set mtime to 40 days ago.
    const now = Date.now();
    const oldMtime = (now - 40 * 86_400_000) / 1000;
    utimesSync(oldFile, oldMtime, oldMtime);

    const r = await runImportCodexAll({ dir: root, since: '30d', stateRoot: root });
    expect(r.files_scanned).toBe(1); // oldFile was filtered out
    expect(r.files_imported).toBe(1);
    expect(r.events_sent).toBeGreaterThan(0);
  });

  it('--all with no --since imports every rollout found', async () => {
    const another = join(root, 'rollout-extra.jsonl');
    writeFileSync(another, FIXTURE);
    const r = await runImportCodexAll({ dir: root, stateRoot: root });
    expect(r.files_scanned).toBe(2);
    expect(r.files_imported).toBe(2);
  });

  it('--since with malformed value throws', async () => {
    await expect(runImportCodexAll({ dir: root, since: 'forever' })).rejects.toThrow(/invalid/);
  });
});

describe('parseDuration', () => {
  it.each([
    ['30d', 30 * 86_400_000],
    ['24h', 24 * 3_600_000],
    ['60m', 60 * 60_000],
    ['45s', 45_000],
    ['1D', 86_400_000], // case-insensitive
  ])('parses %s', (s, expected) => {
    expect(parseDuration(s)).toBe(expected);
  });

  it.each(['', 'abc', '30', '30x', '-5d', '0d'])('rejects %p', (s) => {
    expect(parseDuration(s)).toBeNull();
  });
});
