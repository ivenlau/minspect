import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so isInstalled probes and the reg add/delete calls
// don't actually shell out to reg.exe during CI. Tests that need specific
// behaviour set it via vi.mocked(execFileSync).mockImplementation(Once).
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import {
  __testing__,
  executeScheduledTask,
  planScheduledTask,
  removeScheduledTask,
} from './scheduled-task.js';

const { buildVbsBody, buildRunValue, daemonVbsPath, vbsStringLiteral } = __testing__;

// Tests for the Windows HKCU Run key backend. The value points at a
// wscript wrapper (not node.exe directly — a bare console launch opens a
// visible window whose close kills the daemon), and paths are stored
// verbatim. Both shapes only misbehave at user logon, so we lock them
// down here.

describe('scheduled-task HKCU Run key', () => {
  describe('buildVbsBody', () => {
    it('stores paths verbatim — no backslash doubling anywhere', () => {
      const body = buildVbsBody({
        stateRoot: '',
        paths: {
          nodePath: 'C:\\Program Files\\nodejs\\node.exe',
          minspectBinPath: 'C:\\m.js',
        },
      });
      expect(body).toContain(
        'CreateObject("WScript.Shell").Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\m.js"" serve --quiet", 0, False',
      );
    });

    it('hides the window and does not wait for the daemon', () => {
      const body = buildVbsBody({
        stateRoot: '',
        paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
      });
      expect(body).toContain(', 0, False');
    });

    it('escapes embedded double quotes per VBScript rules (doubling)', () => {
      const body = buildVbsBody({
        stateRoot: '',
        paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\we"rd.js' },
      });
      expect(body).toContain('""C:\\we""rd.js""');
    });
  });

  describe('vbsStringLiteral', () => {
    it('wraps the value in quotes and doubles embedded quotes', () => {
      expect(vbsStringLiteral('a"b')).toBe('"a""b"');
      expect(vbsStringLiteral('plain')).toBe('"plain"');
    });
  });

  describe('buildRunValue', () => {
    it('points wscript.exe at the generated wrapper with a verbatim path', () => {
      const value = buildRunValue({
        stateRoot: 'C:\\Users\\u\\AppData\\Local\\minspect',
        paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
      });
      expect(value).toBe(
        'wscript.exe "C:\\Users\\u\\AppData\\Local\\minspect\\minspect-daemon.vbs"',
      );
    });
  });

  describe('daemonVbsPath', () => {
    it('lands in the state root', () => {
      const p = daemonVbsPath({
        stateRoot: 'C:\\state',
        paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
      });
      expect(p).toBe(join('C:\\state', 'minspect-daemon.vbs'));
    });

    it('falls back to the default state dir when stateRoot is empty', () => {
      const p = daemonVbsPath({
        stateRoot: '',
        paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
      });
      expect(p.endsWith('minspect-daemon.vbs')).toBe(true);
      expect(p.includes('minspect')).toBe(true);
    });
  });
});

describe('planScheduledTask', () => {
  // The plan shape is what install-autostart consumes; covering it here
  // means we don't have to spin up an install call just to assert the
  // static args.
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-scheduled-'));
    vi.mocked(execFileSync).mockReset();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('unitPath is the registry value, not a file', () => {
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.backend).toBe('scheduled-task');
    expect(plan.unitPath).toBe(
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\minspect-daemon',
    );
  });

  it('unitBody is the wscript launcher line for the generated wrapper', () => {
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.unitBody).toBe(`wscript.exe "${join(root, 'minspect-daemon.vbs')}"`);
  });

  it('enable command is reg add with the documented flags and no doubled backslashes', () => {
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.enable.cmd).toBe('reg');
    expect(plan.enable.args).toEqual([
      'add',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'minspect-daemon',
      '/t',
      'REG_SZ',
      '/d',
      `wscript.exe "${join(root, 'minspect-daemon.vbs')}"`,
      '/f',
    ]);
    // The /d data is stored verbatim by reg.exe — a doubled backslash
    // would end up literally in the registry value (the escapeReg bug).
    expect(plan.enable.args.join(' ')).not.toMatch(/\\\\/);
  });

  it('disable command is reg delete', () => {
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.disable.cmd).toBe('reg');
    expect(plan.disable.args).toEqual([
      'delete',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'minspect-daemon',
      '/f',
    ]);
  });

  it('isInstalled returns true when reg query succeeds', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(''));
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.isInstalled()).toBe(true);
    // Verify it called the right thing, not some other reg command.
    const call = vi.mocked(execFileSync).mock.calls[0] as [string, string[]];
    expect(call[0]).toBe('reg');
    expect(call[1]).toEqual([
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'minspect-daemon',
    ]);
  });

  it('isInstalled returns false when reg query fails', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('ERROR: The system cannot find the registry key specified.');
    });
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.isInstalled()).toBe(false);
  });
});

describe('executeScheduledTask', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-scheduled-exec-'));
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));
  });
  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  const ctxFor = (stateRoot: string) => ({
    stateRoot,
    paths: { nodePath: 'C:\\Program Files\\nodejs\\node.exe', minspectBinPath: 'C:\\m.js' },
  });

  it('writes a UTF-16LE BOM wrapper whose decoded body carries the verbatim command', () => {
    const ctx = ctxFor(root);
    const plan = planScheduledTask(ctx);
    executeScheduledTask(plan, ctx);
    const vbsPath = join(root, 'minspect-daemon.vbs');
    expect(existsSync(vbsPath)).toBe(true);
    const buf = readFileSync(vbsPath);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xfe);
    const text = buf.subarray(2).toString('utf16le');
    expect(text).toContain(
      'CreateObject("WScript.Shell").Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\m.js"" serve --quiet", 0, False',
    );
  });

  it('creates a missing state dir instead of failing the install', () => {
    const nested = join(root, 'nested', 'state');
    const ctx = ctxFor(nested);
    const plan = planScheduledTask(ctx);
    executeScheduledTask(plan, ctx);
    expect(existsSync(join(nested, 'minspect-daemon.vbs'))).toBe(true);
  });

  it('writes the wrapper before registering, so a failed reg add leaves the file in place', () => {
    const ctx = ctxFor(root);
    const plan = planScheduledTask(ctx);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('Access is denied.');
    });
    expect(() => executeScheduledTask(plan, ctx)).toThrow('Access is denied.');
    expect(existsSync(join(root, 'minspect-daemon.vbs'))).toBe(true);
  });
});

describe('removeScheduledTask', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-scheduled-rm-'));
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));
  });
  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  });

  it('deletes the Run value per the plan and removes the wrapper file', () => {
    const ctx = {
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    };
    const plan = planScheduledTask(ctx);
    const vbsPath = join(root, 'minspect-daemon.vbs');
    writeFileSync(vbsPath, 'stale');
    removeScheduledTask(plan, ctx);
    expect(existsSync(vbsPath)).toBe(false);
    const call = vi.mocked(execFileSync).mock.calls[0] as [string, string[]];
    expect(call[0]).toBe('reg');
    expect(call[1]).toEqual(plan.disable.args);
  });

  it('is silent when nothing was installed (no wrapper file, reg delete fails)', () => {
    const ctx = {
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    };
    const plan = planScheduledTask(ctx);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not installed');
    });
    expect(() => removeScheduledTask(plan, ctx)).not.toThrow();
    expect(existsSync(join(root, 'minspect-daemon.vbs'))).toBe(false);
  });
});
