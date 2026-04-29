import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstall } from './install.js';

describe('runInstall', () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'minspect-install-'));
    settingsPath = join(dir, 'settings.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates settings.json with all required hook event entries', () => {
    const res = runInstall({
      agent: 'claude-code',
      settingsPath,
      aiHistoryBin: '/usr/local/bin/minspect',
    });
    expect(res.wrote).toBe(true);
    const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(s.hooks).sort()).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
  });

  it('backs up existing settings to .bak.<ts>', () => {
    writeFileSync(settingsPath, JSON.stringify({ unrelated: true }));
    const res = runInstall({
      agent: 'claude-code',
      settingsPath,
      aiHistoryBin: '/usr/local/bin/minspect',
    });
    expect(res.backup).toBeDefined();
    if (res.backup) {
      expect(existsSync(res.backup)).toBe(true);
      const backed = JSON.parse(readFileSync(res.backup, 'utf8')) as { unrelated: boolean };
      expect(backed.unrelated).toBe(true);
    }
  });

  it('is idempotent — re-running does not duplicate our hook entries', () => {
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/bin/minspect' });
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/bin/minspect' });
    const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    // Each event has exactly one entry (ours), not two.
    for (const v of Object.values(s.hooks)) {
      expect(v.length).toBe(1);
    }
  });

  it('preserves user-owned unrelated hooks', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'user-tool --foo' }] }],
        },
      }),
    );
    runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/bin/minspect' });
    const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const commands = s.hooks.PreToolUse?.flatMap((e) => e.hooks.map((h) => h.command)) ?? [];
    expect(commands).toContain('user-tool --foo');
    expect(commands.some((c) => c.includes('minspect') && c.includes('pre_tool'))).toBe(true);
  });

  it('refuses to overwrite malformed settings', () => {
    writeFileSync(settingsPath, '{not-valid-json');
    expect(() =>
      runInstall({ agent: 'claude-code', settingsPath, aiHistoryBin: '/bin/minspect' }),
    ).toThrow(/malformed settings/);
  });
});
