import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { DEFAULT_PORT, runServe, runStop } from './serve.js';

// Pass port: 0 in every test so a parallel `minspect serve` on the dev box
// can't get reused as a "running daemon" and corrupt the fixture.
describe('runServe / runStop', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-serve-'));
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // ignore
    }
  });

  it('starts a server, writes state file, then stop() tears it down', async () => {
    const handle = await runServe({ noOpen: true, stateRoot: root, port: 0 });
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.reused).toBe(false);
    expect(existsSync(getStateFilePath(root))).toBe(true);

    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.ok).toBe(true);

    await handle.stop();
    expect(existsSync(getStateFilePath(root))).toBe(false);
  });

  it('re-running reuses existing daemon', async () => {
    const first = await runServe({ noOpen: true, stateRoot: root, port: 0 });
    const second = await runServe({ noOpen: true, stateRoot: root, port: 0 });
    expect(second.reused).toBe(true);
    expect(second.port).toBe(first.port);
    await first.stop();
  });

  // Card 50 regression: detach-spawned `serve --quiet` processes (from
  // init auto-spawn or hook auto-spawn) that land on the reuse path used
  // to unconditionally open the browser, which is how a single codex
  // import could pop N browser windows. Both paths must now honor quiet.
  it('reuse path does not open browser when quiet=true', async () => {
    const first = await runServe({ noOpen: true, stateRoot: root, port: 0 });
    let opens = 0;
    const second = await runServe({
      stateRoot: root,
      port: 0,
      quiet: true,
      openBrowser: () => {
        opens += 1;
      },
    });
    expect(second.reused).toBe(true);
    expect(opens).toBe(0);
    await first.stop();
  });

  it('fresh-start path does not open browser when quiet=true', async () => {
    let opens = 0;
    const handle = await runServe({
      stateRoot: root,
      port: 0,
      quiet: true,
      openBrowser: () => {
        opens += 1;
      },
    });
    expect(opens).toBe(0);
    await handle.stop();
  });

  it('runStop returns false when no daemon is running', async () => {
    const stopped = await runStop({ stateRoot: root });
    expect(stopped).toBe(false);
  });

  // Covers the default code path (no explicit port): land on DEFAULT_PORT
  // when free, walk upward when it's already bound. Skipped if something
  // else on the dev box is holding DEFAULT_PORT when the test starts.
  it('falls back to DEFAULT_PORT+1 when DEFAULT_PORT is busy', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(DEFAULT_PORT, '127.0.0.1', () => resolve());
    }).catch(() => {
      /* port already taken by someone else; swap for random so the outer
         `await` doesn't see an unhandled rejection */
      blocker.close();
    });
    if (!blocker.listening) {
      // Dev box already occupies DEFAULT_PORT — can't exercise the default
      // path deterministically. Nothing to assert.
      return;
    }

    try {
      const handle = await runServe({ noOpen: true, stateRoot: root });
      expect(handle.port).toBeGreaterThanOrEqual(DEFAULT_PORT + 1);
      await handle.stop();
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
