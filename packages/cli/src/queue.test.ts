import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event, GitState } from '@minspect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueEvent, listQueued, quarantineQueued, readQueued, removeQueued } from './queue.js';

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

describe('queue', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-q-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('enqueues and lists in time order', async () => {
    enqueueEvent(sampleEvent('a'), root);
    // Sleep 2 ms so Date.now() ticks on Windows low-res timers.
    await new Promise((r) => setTimeout(r, 2));
    enqueueEvent(sampleEvent('b'), root);
    const files = listQueued(root);
    expect(files).toHaveLength(2);
    const first = readQueued(files[0] as string);
    expect(first).toMatchObject({ session_id: 'a' });
  });

  it('removeQueued clears the file', () => {
    enqueueEvent(sampleEvent('x'), root);
    const files = listQueued(root);
    expect(files).toHaveLength(1);
    removeQueued(files[0] as string);
    expect(listQueued(root)).toHaveLength(0);
  });

  it('quarantineQueued moves file into .poison and leaves main queue clean', () => {
    enqueueEvent(sampleEvent('p'), root);
    const [file] = listQueued(root);
    expect(file).toBeDefined();
    quarantineQueued(file as string, root);
    // Main queue is empty again — drainer can make progress.
    expect(listQueued(root)).toHaveLength(0);
    // Poisoned file preserved for inspection.
    const poisonDir = join(root, 'queue', '.poison');
    expect(existsSync(poisonDir)).toBe(true);
    expect(readdirSync(poisonDir)).toHaveLength(1);
  });
});
