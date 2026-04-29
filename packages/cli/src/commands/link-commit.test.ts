import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { runLinkCommit } from './link-commit.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

describe('runLinkCommit', () => {
  let root: string;
  let repo: string;
  let port: number;
  let serverClose: () => Promise<void>;
  let received: Array<{
    commit_sha: string;
    workspace: string;
    changed_files: string[];
  }>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'minspect-lc-'));
    repo = mkdtempSync(join(tmpdir(), 'minspect-repo-'));
    received = [];

    const server = createServer((req, res) => {
      if (req.url === '/commit-links' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c.toString();
        });
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.writeHead(200).end('{"linked":0,"edit_ids":[]}');
        });
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    port = addr.port;
    serverClose = () => new Promise<void>((r) => server.close(() => r()));

    mkdirSync(root, { recursive: true });
    writeFileSync(
      getStateFilePath(root),
      JSON.stringify({ port, pid: process.pid, started_at: Date.now() }),
    );
  });
  afterEach(async () => {
    await serverClose();
    // On Windows, git sub-process handles linger briefly; retry with backoff.
    const cleanup = (p: string) => {
      try {
        rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // best-effort; leftover tmp dirs are fine
      }
    };
    cleanup(root);
    cleanup(repo);
  });

  it('posts commit_sha + changed files for a normal commit', async () => {
    git(['init', '-b', 'main'], repo);
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(['add', 'a.txt'], repo);
    git(['commit', '-m', 'first'], repo);
    writeFileSync(join(repo, 'a.txt'), 'hello2');
    writeFileSync(join(repo, 'b.txt'), 'b');
    git(['add', 'a.txt', 'b.txt'], repo);
    git(['commit', '-m', 'second'], repo);

    await runLinkCommit({ cwd: repo, stateRoot: root });

    expect(received).toHaveLength(1);
    expect(received[0]?.changed_files?.sort()).toEqual(['a.txt', 'b.txt']);
    expect(received[0]?.commit_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(received[0]?.workspace).toBe(repo.replace(/\\/g, '/'));
  });

  it('handles first commit (no HEAD~1) via git show fallback', async () => {
    git(['init', '-b', 'main'], repo);
    writeFileSync(join(repo, 'x.txt'), 'first');
    git(['add', 'x.txt'], repo);
    git(['commit', '-m', 'first'], repo);

    await runLinkCommit({ cwd: repo, stateRoot: root });
    expect(received).toHaveLength(1);
    expect(received[0]?.changed_files).toContain('x.txt');
  });

  it('skips when not in a git repo (silent)', async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'minspect-nonrepo-'));
    await runLinkCommit({ cwd: nonRepo, stateRoot: root });
    expect(received).toHaveLength(0);
    rmSync(nonRepo, { recursive: true, force: true });
  });
});
