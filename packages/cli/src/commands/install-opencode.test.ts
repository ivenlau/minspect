import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BEGIN_MARKER, END_MARKER, runInstallOpenCode } from './install-opencode.js';

describe('runInstallOpenCode', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-oci-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('first install: writes plugin file with managed markers and no backup', () => {
    const plugin = join(root, 'plugins', 'minspect.ts');
    const res = runInstallOpenCode({
      pluginPath: plugin,
      aiHistoryBin: '/absolute/path/minspect',
    });
    expect(res.path).toBe(plugin);
    expect(res.wrote).toBe(true);
    expect(res.backup).toBeUndefined();
    const content = readFileSync(plugin, 'utf8');
    expect(content).toContain(BEGIN_MARKER);
    expect(content).toContain(END_MARKER);
    expect(content).toContain("import type { Plugin } from '@opencode-ai/plugin'");
    expect(content).toContain('capture-opencode');
    expect(content).toContain('/absolute/path/minspect');
  });

  it('idempotent re-install: backs up previous managed version', () => {
    const plugin = join(root, 'minspect.ts');
    runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    const res2 = runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    expect(res2.backup).toBeDefined();
    expect(existsSync(res2.backup ?? '')).toBe(true);
    const content = readFileSync(plugin, 'utf8');
    // Still exactly one managed block (no duplicates).
    const begins = content.split(BEGIN_MARKER).length - 1;
    const ends = content.split(END_MARKER).length - 1;
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it('foreign file at path: backs it up, then writes managed file on top', () => {
    const plugin = join(root, 'minspect.ts');
    mkdirSync(root, { recursive: true });
    writeFileSync(plugin, '// hand-written plugin — pre-existing');
    const res = runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    expect(res.backup).toBeDefined();
    if (!res.backup) throw new Error('expected backup');
    expect(existsSync(res.backup)).toBe(true);
    expect(readFileSync(res.backup, 'utf8')).toContain('hand-written plugin');
    const current = readFileSync(plugin, 'utf8');
    expect(current).toContain(BEGIN_MARKER);
  });

  it('creates plugin directory if missing', () => {
    const plugin = join(root, 'deep', 'nested', 'plugins', 'minspect.ts');
    runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    expect(existsSync(plugin)).toBe(true);
    // directory listing reflects the creation
    const dir = join(root, 'deep', 'nested', 'plugins');
    expect(readdirSync(dir)).toContain('minspect.ts');
  });

  it('escapes Windows backslashes in bin path', () => {
    const plugin = join(root, 'minspect.ts');
    runInstallOpenCode({
      pluginPath: plugin,
      aiHistoryBin: 'C:\\Users\\me\\bin\\minspect.cmd',
    });
    const content = readFileSync(plugin, 'utf8');
    expect(content).toContain('"C:\\\\Users\\\\me\\\\bin\\\\minspect.cmd"');
  });

  it('plugin template routes .js bin through NODE_BIN (not process.execPath; OpenCode is a native binary)', () => {
    const plugin = join(root, 'minspect.ts');
    runInstallOpenCode({
      pluginPath: plugin,
      aiHistoryBin: 'C:\\Users\\me\\minspect\\dist\\bin.js',
    });
    const content = readFileSync(plugin, 'utf8');
    // The resolver must resolve to node (via PATH) for .js/.mjs/.cjs files —
    // OpenCode's own process.execPath is opencode.exe which can't run JS.
    expect(content).toContain("lower.endsWith('.js')");
    expect(content).toContain('NODE_BIN');
    expect(content).toContain("process.env.MINSPECT_NODE || 'node'");
  });

  it('plugin template filters streaming events before spawning (prevents PS window storm)', () => {
    const plugin = join(root, 'minspect.ts');
    runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    const content = readFileSync(plugin, 'utf8');
    // Filter must gate the spawn.
    expect(content).toContain('function shouldForward');
    expect(content).toContain('if (!shouldForward(ev))');
    // Only terminal states produce a forwarded event.
    expect(content).toContain("status === 'completed' || status === 'error'");
    expect(content).toContain('part.time.end != null');
  });

  it('plugin template NEVER sets detached:true on spawn (avoids new console on Windows)', () => {
    const plugin = join(root, 'minspect.ts');
    runInstallOpenCode({ pluginPath: plugin, aiHistoryBin: '/a/b' });
    const content = readFileSync(plugin, 'utf8');
    // Strip comments first so the assertion only looks at code.
    const code = content
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/detached:\s*true/);
    expect(content).toContain('windowsHide: true');
  });
});
