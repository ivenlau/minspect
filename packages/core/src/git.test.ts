import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGitState } from './git.js';

function runGit(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

describe('readGitState', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'minspect-git-'));
  });
  afterEach(() => {
    // Windows: git sub-process handles can linger; retry to dodge EPERM.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // best effort
    }
  });

  it('returns null for a non-git directory', () => {
    expect(readGitState(dir)).toBeNull();
  });

  it('returns empty head and clean=false (no unindexed) for a fresh repo with no commits', () => {
    runGit(['init', '-b', 'main'], dir);
    const state = readGitState(dir);
    expect(state).not.toBeNull();
    expect(state?.branch).toBe('main');
    expect(state?.head).toBe('');
    expect(state?.dirty).toBe(false);
  });

  it('returns populated state after a commit on a clean tree', () => {
    runGit(['init', '-b', 'main'], dir);
    writeFileSync(join(dir, 'a.txt'), 'hello');
    runGit(['add', 'a.txt'], dir);
    runGit(['commit', '-m', 'first'], dir);

    const state = readGitState(dir);
    expect(state).not.toBeNull();
    expect(state?.branch).toBe('main');
    expect(state?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state?.dirty).toBe(false);
  });

  it('detects a dirty working tree', () => {
    runGit(['init', '-b', 'main'], dir);
    writeFileSync(join(dir, 'a.txt'), 'hello');
    runGit(['add', 'a.txt'], dir);
    runGit(['commit', '-m', 'first'], dir);

    writeFileSync(join(dir, 'a.txt'), 'hello-modified');
    const state = readGitState(dir);
    expect(state?.dirty).toBe(true);
  });
});
