import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDbPath, getStateDir, getStateFilePath, readState, writeState } from './state.js';

describe('state', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'minspect-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads state.json round-trip', () => {
    const state = { port: 54321, pid: 9999, started_at: 1_700_000_000_000 };
    writeState(state, dir);
    expect(readState(dir)).toEqual(state);
  });

  it('readState returns null when file does not exist', () => {
    expect(readState(dir)).toBeNull();
  });

  it('readState returns null for corrupt JSON (never throws)', () => {
    writeFileSync(getStateFilePath(dir), '{not-json');
    expect(readState(dir)).toBeNull();
  });

  it('getDbPath is rooted in the given dir', () => {
    expect(getDbPath(dir)).toBe(join(dir, 'history.sqlite'));
  });

  it('getStateDir respects LOCALAPPDATA on Windows', () => {
    if (process.platform !== 'win32') return;
    expect(getStateDir()).toMatch(/minspect$/);
  });
});
