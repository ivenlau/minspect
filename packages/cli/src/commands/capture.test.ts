import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeCodePayload } from '@minspect/adapter-claude-code';
import type { Event } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { listQueued } from '../queue.js';
import { readSessionState } from '../session-state.js';
import { runCapture } from './capture.js';

describe('runCapture', () => {
  let root: string;
  let received: Event[];
  let port: number;
  let serverClose: () => Promise<void>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'minspect-cap-'));
    received = [];
    // Minimal stub collector (avoids fastify dep in this test file).
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
    port = addr.port;
    serverClose = () => new Promise<void>((resolve) => server.close(() => resolve()));

    // Write state file so CLI finds the collector.
    mkdirSync(root, { recursive: true });
    writeFileSync(
      getStateFilePath(root),
      JSON.stringify({ port, pid: process.pid, started_at: Date.now() }),
    );
  });
  afterEach(async () => {
    await serverClose();
    rmSync(root, { recursive: true, force: true });
  });

  it('SessionStart → emits session_start, resets state', async () => {
    const payload: ClaudeCodePayload = {
      session_id: 'sess-1',
      cwd: root,
      hook_event_name: 'SessionStart',
      source: 'startup',
    };
    const events = await runCapture({ stateRoot: root, payload });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('session_start');
    expect(received).toHaveLength(1);
  });

  it('full turn flow: Prompt → PreTool → PostTool with file read → Stop', async () => {
    // Seed a file on disk to capture as before/after.
    const filePath = join(root, 'a.txt');
    writeFileSync(filePath, 'old content');

    await runCapture({
      stateRoot: root,
      payload: {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    });
    await runCapture({
      stateRoot: root,
      payload: {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'please edit a.txt',
      },
    });
    // PreToolUse — read current content as before.
    await runCapture({
      stateRoot: root,
      payload: {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'old', new_string: 'new' },
      },
    });

    // Simulate the tool running: mutate the file.
    writeFileSync(filePath, 'new content');

    const postEvents = await runCapture({
      stateRoot: root,
      payload: {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'old', new_string: 'new' },
        tool_response: { success: true },
      },
    });

    const toolCall = postEvents[0];
    expect(toolCall?.type).toBe('tool_call');
    if (toolCall?.type === 'tool_call') {
      expect(toolCall.file_edits?.[0]?.before_content).toBe('old content');
      expect(toolCall.file_edits?.[0]?.after_content).toBe('new content');
    }

    await runCapture({
      stateRoot: root,
      payload: {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'Stop',
      },
    });

    // Expect: session_start, turn_start, (no PreToolUse event), tool_call, turn_end = 4
    expect(received.map((e) => e.type)).toEqual([
      'session_start',
      'turn_start',
      'tool_call',
      'turn_end',
    ]);
    const state = readSessionState('s1', root);
    expect(state.current_turn_id).toBeNull();
  });

  it('queues events on POST failure (collector down)', async () => {
    // Stop the collector so POSTs fail.
    await serverClose();
    serverClose = async () => {
      /* no-op */
    };

    await runCapture({
      stateRoot: root,
      payload: {
        session_id: 'sx',
        cwd: root,
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    });
    const queued = listQueued(root);
    expect(queued.length).toBe(1);
  });
});
