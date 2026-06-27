import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so isInstalled probes don't actually shell out to
// reg.exe during CI. Tests that need specific behaviour set it via
// vi.mocked(execFileSync).mockImplementationOnce.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import { __testing__, planScheduledTask } from './scheduled-task.js';

const { escapeReg, buildCommand } = __testing__;

// Tests for the Windows HKCU Run key backend. The whole backend is just
// a thin wrapper over `reg add` / `reg query` / `reg delete`, but the
// escape rules and command shape are easy to get wrong in ways that
// would only surface at user logon — so we lock them down here.

describe('scheduled-task HKCU Run key', () => {
  describe('escapeReg', () => {
    it('doubles backslashes so the registry sees the literal path', () => {
      expect(escapeReg('C:\\node\\node.exe')).toBe('C:\\\\node\\\\node.exe');
    });

    it('escapes embedded double quotes (reg.exe uses them as delimiters)', () => {
      expect(escapeReg('a"b')).toBe('a\\"b');
    });

    it('handles backslashes and quotes together', () => {
      expect(escapeReg('C:\\"weird"\\path')).toBe('C:\\\\\\"weird\\"\\\\path');
    });

    it('leaves a plain path untouched', () => {
      expect(escapeReg('C:/node/node.exe')).toBe('C:/node/node.exe');
    });
  });

  describe('buildCommand', () => {
    it('produces a fully-quoted node + bin + serve --quiet invocation', () => {
      const cmd = buildCommand({
        stateRoot: '',
        paths: { nodePath: 'C:\\node.exe', minspectBinPath: 'C:\\bin.js' },
      });
      // Path is `'C:\node.exe'` in actual string (one backslash);
      // escapeReg doubles it to two so reg.exe does not eat it.
      expect(cmd).toBe('"C:\\\\node.exe" "C:\\\\bin.js" serve --quiet');
    });

    it('escapes backslashes inside the quoted paths', () => {
      const cmd = buildCommand({
        stateRoot: '',
        paths: { nodePath: 'C:\\Program Files\\nodejs\\node.exe', minspectBinPath: 'C:\\m.js' },
      });
      // The outer quotes stay literal (reg.exe strips them when reading
      // the value); the inner backslashes are doubled so reg.exe does
      // not eat them as escape sequences.
      expect(cmd).toBe('"C:\\\\Program Files\\\\nodejs\\\\node.exe" "C:\\\\m.js" serve --quiet');
    });

    it('escapes inner quotes in the path', () => {
      const cmd = buildCommand({
        stateRoot: '',
        paths: { nodePath: 'C:\\node.exe', minspectBinPath: 'C:\\weird"name.js' },
      });
      expect(cmd).toBe('"C:\\\\node.exe" "C:\\\\weird\\"name.js" serve --quiet');
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

  it('unitBody is the command line that reg.exe stores', () => {
    const plan = planScheduledTask({
      stateRoot: root,
      paths: { nodePath: 'C:\\n.exe', minspectBinPath: 'C:\\m.js' },
    });
    expect(plan.unitBody).toBe('"C:\\\\n.exe" "C:\\\\m.js" serve --quiet');
  });

  it('enable command is reg add with the documented flags', () => {
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
      '"C:\\\\n.exe" "C:\\\\m.js" serve --quiet',
      '/f',
    ]);
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
