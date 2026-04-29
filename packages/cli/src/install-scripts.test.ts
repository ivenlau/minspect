import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Keeps the two installers in sync (same flags, same Node version floor,
// same error-handling shape) and catches syntax regressions without us
// having to actually fetch from GitHub and pipe into a shell.

// This file lives in packages/cli/src/. Walk up three levels to repo root.
const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const SH = join(ROOT, 'scripts', 'install.sh');
const PS1 = join(ROOT, 'scripts', 'install.ps1');

describe('install scripts', () => {
  it('install.sh and install.ps1 both exist', () => {
    expect(existsSync(SH)).toBe(true);
    expect(existsSync(PS1)).toBe(true);
  });

  it('both enforce the same Node major floor (20)', () => {
    const sh = readFileSync(SH, 'utf8');
    const ps = readFileSync(PS1, 'utf8');
    expect(sh).toMatch(/"\$NODE_MAJOR" -lt 20/);
    expect(ps).toMatch(/\$nodeMajor -lt 20/);
  });

  it('both accept --version and --skip-init (PS: -Version / -SkipInit)', () => {
    const sh = readFileSync(SH, 'utf8');
    const ps = readFileSync(PS1, 'utf8');
    expect(sh).toMatch(/--version/);
    expect(sh).toMatch(/--skip-init/);
    expect(ps).toMatch(/\[string\]\$Version/);
    expect(ps).toMatch(/\[switch\]\$SkipInit/);
  });

  it('both install the public npm package name, not the workspace one', () => {
    const sh = readFileSync(SH, 'utf8');
    const ps = readFileSync(PS1, 'utf8');
    // Ensure we never accidentally migrate the one-liner to @minspect/cli.
    expect(sh).not.toMatch(/@minspect\/cli/);
    expect(ps).not.toMatch(/@minspect\/cli/);
    expect(sh).toMatch(/PKG="@ivenlau\/minspect"/);
    expect(ps).toMatch(/"@ivenlau\/minspect"/);
  });

  it('install.sh parses under POSIX sh', () => {
    // This relies on `sh` being available — git-bash on Windows, /bin/sh
    // elsewhere. Skip if not reachable.
    try {
      execFileSync('sh', ['-n', SH], { stdio: 'pipe' });
    } catch (err) {
      const msg = (err as { code?: string }).code;
      if (msg === 'ENOENT') return; // skip on systems without sh
      throw err;
    }
  });

  it('install.ps1 parses under PowerShell', () => {
    // PowerShell is always present on Windows; skip elsewhere.
    if (process.platform !== 'win32') return;
    try {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `try { [scriptblock]::Create((Get-Content '${PS1.replace(/'/g, "''")}' -Raw)) | Out-Null } catch { Write-Error $_; exit 1 }`,
        ],
        { stdio: 'pipe' },
      );
    } catch (err) {
      const msg = (err as { code?: string }).code;
      if (msg === 'ENOENT') return;
      throw err;
    }
  });
});
