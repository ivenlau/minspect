import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStart } from './start.js';

// Tests for the standalone `minspect start` shim. The actual spawn logic
// lives in runStartDaemonDetached (covered by init.test.ts). Here we
// only assert that start forwards options correctly and surfaces the
// three outcomes the CLI cares about: already-running, fresh-spawn, and
// spawn-but-never-ready.

describe('runStart', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-start-'));
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('returns existing daemon (no spawn, no wait) when one is already running', async () => {
    let spawnCalls = 0;
    let waitCalls = 0;
    const r = await runStart({
      stateRoot: root,
      findRunningDaemon: async () => ({ port: 21477, pid: 11111 }),
      spawnServe: () => {
        spawnCalls += 1;
        return { pid: 99999 };
      },
      waitForDaemon: async () => {
        waitCalls += 1;
        return { port: 21477, pid: 11111 };
      },
    });
    expect(r.daemonStarted).toBe(true);
    expect(r.port).toBe(21477);
    expect(r.spawned).toBe(false); // reused, did not actually fork
    expect(spawnCalls).toBe(0);
    expect(waitCalls).toBe(0);
  });

  it('spawns + waits when no daemon is running', async () => {
    let spawnCalls = 0;
    let waitCalls = 0;
    const r = await runStart({
      stateRoot: root,
      findRunningDaemon: async () => null,
      spawnServe: () => {
        spawnCalls += 1;
        return { pid: 22222 };
      },
      waitForDaemon: async () => {
        waitCalls += 1;
        return { port: 21477, pid: 22222 };
      },
    });
    expect(r.daemonStarted).toBe(true);
    expect(r.port).toBe(21477);
    expect(r.spawned).toBe(true);
    expect(spawnCalls).toBe(1);
    expect(waitCalls).toBe(1);
  });

  it('reports spawnFailed when spawn() returns null (no forked child)', async () => {
    const r = await runStart({
      stateRoot: root,
      findRunningDaemon: async () => null,
      spawnServe: () => null,
      waitForDaemon: async () => {
        throw new Error('wait should not be called when spawn returns null');
      },
    });
    expect(r.daemonStarted).toBe(false);
    expect(r.spawned).toBe(true); // we tried
    expect(r.spawnFailed).toBe(true);
    expect(r.port).toBeUndefined();
  });

  it('reports timeout when spawn succeeds but daemon never comes up', async () => {
    const r = await runStart({
      stateRoot: root,
      findRunningDaemon: async () => null,
      spawnServe: () => ({ pid: 33333 }),
      waitForDaemon: async () => null,
    });
    expect(r.daemonStarted).toBe(false);
    expect(r.spawned).toBe(true);
    expect(r.spawnFailed).toBe(false); // spawn succeeded, /health timed out
    expect(r.port).toBeUndefined();
  });

  it('does not open the browser even when test seam is injected (start is headless)', async () => {
    let browserCalls = 0;
    await runStart({
      stateRoot: root,
      findRunningDaemon: async () => null,
      spawnServe: () => ({ pid: 44444 }),
      waitForDaemon: async () => ({ port: 21477, pid: 44444 }),
      openBrowserFn: () => {
        browserCalls += 1;
      },
    });
    expect(browserCalls).toBe(0);
  });
});
