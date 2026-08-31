import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Global test sandbox for the CLI suite. Runs once per worker before any
// test module is imported (see vitest.config.ts setupFiles).
//
// Production code derives user paths from os.homedir() (install/doctor/
// status/capture) and from LOCALAPPDATA / XDG_* (paths.ts state dir).
// os.homedir() reads USERPROFILE on Windows and HOME on unix, so a test
// run that only overrides HOME (as the per-case helpers historically did)
// still writes straight into the real user profile on Windows — this has
// deleted real hook config and the real HKCU Run key before. Point every
// one of those roots at a throwaway directory so the suite can never
// touch real user state, on any host.

const sandbox = mkdtempSync(join(tmpdir(), 'minspect-cli-tests-'));
mkdirSync(join(sandbox, 'AppData', 'Local'), { recursive: true });
mkdirSync(join(sandbox, '.config'), { recursive: true });
mkdirSync(join(sandbox, '.local', 'state'), { recursive: true });

process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.LOCALAPPDATA = join(sandbox, 'AppData', 'Local');
process.env.XDG_CONFIG_HOME = join(sandbox, '.config');
process.env.XDG_STATE_HOME = join(sandbox, '.local', 'state');

// Tests may re-override any of the above per-case; drop the sandbox when
// the worker exits so a crashed run doesn't leak temp dirs.
process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* best effort */
  }
});
