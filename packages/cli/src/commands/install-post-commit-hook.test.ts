import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPostCommitHook } from './install-post-commit-hook.js';

describe('installPostCommitHook', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'minspect-hooks-'));
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('creates a new post-commit with shebang + managed block', () => {
    const res = installPostCommitHook({ repoRoot: repo, aiHistoryBin: '/bin/minspect' });
    expect(res.created).toBe(true);
    const body = readFileSync(res.path, 'utf8');
    expect(body.startsWith('#!/bin/sh')).toBe(true);
    expect(body).toContain('>>> minspect managed >>>');
    expect(body).toContain('link-commit');
  });

  it('appends to an existing hook, preserves user content, backs up', () => {
    const hook = join(repo, '.git', 'hooks', 'post-commit');
    writeFileSync(hook, '#!/bin/sh\n# user custom\nrun-user-thing\n');
    const res = installPostCommitHook({ repoRoot: repo, aiHistoryBin: '/bin/minspect' });
    expect(res.created).toBe(false);
    expect(res.backup).toBeDefined();
    if (res.backup) {
      expect(existsSync(res.backup)).toBe(true);
    }
    const body = readFileSync(hook, 'utf8');
    expect(body).toContain('run-user-thing');
    expect(body).toContain('>>> minspect managed >>>');
  });

  it('is idempotent — second install does not duplicate our block', () => {
    installPostCommitHook({ repoRoot: repo, aiHistoryBin: '/bin/minspect' });
    installPostCommitHook({ repoRoot: repo, aiHistoryBin: '/bin/minspect' });
    const body = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8');
    const matches = body.match(/>>> minspect managed >>>/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('normalizes Windows backslashes in bin path to forward slashes', () => {
    const res = installPostCommitHook({
      repoRoot: repo,
      aiHistoryBin: 'C:\\Program Files\\minspect\\minspect.exe',
    });
    const body = readFileSync(res.path, 'utf8');
    expect(body).toContain('C:/Program Files/minspect/minspect.exe');
    expect(body).not.toContain('\\');
  });
});
