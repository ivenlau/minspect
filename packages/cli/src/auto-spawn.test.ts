import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event, GitState } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeConfig } from './config.js';

// Stub child_process.spawn so we can assert on call without actually forking.
// Must be declared before the transport import so the module sees the mock.
const spawnMock = vi.fn(() => ({
  unref: () => {
    /* noop */
  },
  on: () => {
    /* noop */
  },
}));
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

// Dynamic import so the mock above applies.
const { sendEvent } = await import('./transport.js');

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

describe('auto_spawn_daemon', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-spawn-'));
    mkdirSync(root, { recursive: true });
    spawnMock.mockClear();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('does not spawn when config.auto_spawn_daemon is missing / false', async () => {
    // No daemon.json → sendEvent hits the "no target" branch.
    const res = await sendEvent(sampleEvent('s1'), root);
    expect(res).toBe('queued');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns detached daemon when config.auto_spawn_daemon is true', async () => {
    writeConfig({ auto_spawn_daemon: true }, root);
    const res = await sendEvent(sampleEvent('s1'), root);
    expect(res).toBe('queued');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      { detached?: boolean; env?: Record<string, string>; windowsHide?: boolean },
    ];
    expect(cmd).toBe(process.execPath);
    expect(args).toContain('serve');
    expect(args).toContain('--quiet');
    expect(opts.detached).toBe(true);
    expect(opts.windowsHide).toBe(true);
    expect(opts.env?.MINSPECT_SPAWNED_BY).toBe('hook');
  });

  it('does not spawn when daemon.json already points at a live target', async () => {
    writeConfig({ auto_spawn_daemon: true }, root);
    // daemon.json present → sendEvent hits the "has target" branch and POSTs.
    // We don't need a real server here because the POST will just fail with
    // `transient` and queue the event; the spawn branch is not taken.
    // Write a bogus port that definitely won't connect so we stay on the
    // "has target → postOne → transient" path.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(root, 'state.json'),
      JSON.stringify({ port: 1, pid: process.pid, started_at: Date.now() }),
    );
    await sendEvent(sampleEvent('s1'), root);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
