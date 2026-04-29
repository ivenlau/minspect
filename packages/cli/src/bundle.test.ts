import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structural checks on the bundle output. We don't run the bundled CLI here
// (that requires `npm install` of native deps like better-sqlite3); instead
// we verify: (a) bundle script runs, (b) layout matches what npm publish
// needs, (c) the inlined workspace code is actually present. The real
// end-to-end smoke is a CI step: `npm pack && npm i -g <tarball>`.

const CLI_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(CLI_ROOT, 'dist-bundle');

// The bundle only makes sense after `pnpm -r build`. The script itself
// checks this and refuses to run, but the test shouldn't silently re-build —
// it's a unit test, not a CI orchestrator. We require the prior build.
const PRE_BUILT =
  existsSync(join(CLI_ROOT, 'dist', 'bin.js')) &&
  existsSync(join(CLI_ROOT, '..', 'ui', 'dist', 'spa', 'index.html'));

describe.runIf(PRE_BUILT)('cli bundle', () => {
  it('runs and produces dist-bundle with expected layout', () => {
    // Run the bundler fresh each time.
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', 'bundle.mjs')], {
      cwd: CLI_ROOT,
      stdio: 'pipe',
    });

    expect(existsSync(join(OUT, 'bin.cjs'))).toBe(true);
    expect(existsSync(join(OUT, 'package.json'))).toBe(true);
    expect(existsSync(join(OUT, 'ui', 'index.html'))).toBe(true);
  });

  it('bin.cjs starts with a single shebang', () => {
    const body = readFileSync(join(OUT, 'bin.cjs'), 'utf8');
    expect(body.startsWith('#!/usr/bin/env node\n')).toBe(true);
    // Double shebang would be a parse error at runtime; guard explicitly.
    expect(body.slice('#!/usr/bin/env node\n'.length)).not.toMatch(/^#!/);
  });

  it('package.json is publish-ready (name, bin, files, engines)', () => {
    const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8')) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
      engines: { node: string };
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('minspect');
    expect(pkg.bin.minspect).toBe('./bin.cjs');
    expect(pkg.files).toContain('bin.cjs');
    expect(pkg.files.some((f) => f.startsWith('ui'))).toBe(true);
    expect(pkg.engines.node).toMatch(/>=20/);
    // Native deps kept as external — users get prebuilt binaries via
    // `npm i`. Anything else being present would mean we failed to bundle.
    expect(Object.keys(pkg.dependencies)).toContain('better-sqlite3');
    expect(pkg.dependencies['@minspect/core']).toBeUndefined();
  });

  it('bundle contains inlined workspace code (no @minspect/* requires)', () => {
    const body = readFileSync(join(OUT, 'bin.cjs'), 'utf8');
    // If any require("@minspect/...") leaked through, `npm i minspect` would
    // fail on a machine without workspace links because those packages
    // aren't published.
    expect(body).not.toMatch(/require\(["']@minspect\//);
  });

  it('bundle size is reasonable (<10 MB)', () => {
    const size = statSync(join(OUT, 'bin.cjs')).size;
    expect(size).toBeLessThan(10 * 1024 * 1024);
    expect(size).toBeGreaterThan(100 * 1024); // sanity floor
  });
});
