import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigPath, readConfig, writeConfig } from './config.js';

describe('config', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-config-'));
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('returns empty object when config file missing', () => {
    expect(readConfig(root)).toEqual({});
  });

  it('round-trips auto_spawn_daemon', () => {
    writeConfig({ auto_spawn_daemon: true }, root);
    expect(readConfig(root)).toEqual({ auto_spawn_daemon: true });
    expect(readFileSync(getConfigPath(root), 'utf8')).toMatch(/auto_spawn_daemon/);
  });

  it('returns empty object on malformed JSON', () => {
    writeFileSync(getConfigPath(root), '{ not valid json');
    expect(readConfig(root)).toEqual({});
  });

  it('getConfigPath resolves inside state dir', () => {
    expect(getConfigPath(root)).toBe(join(root, 'config.json'));
  });
});
