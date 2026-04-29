import { execFileSync } from 'node:child_process';
import { readCollectorTarget } from '../transport.js';

export interface LinkCommitOptions {
  cwd?: string;
  stateRoot?: string;
}

function run(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runLinkCommit(opts: LinkCommitOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();

  // Resolve workspace root. If not a repo, bail silently.
  let workspace: string;
  try {
    workspace = run(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch {
    return;
  }

  const sha = run(['rev-parse', 'HEAD'], workspace).trim();
  if (!sha) return;

  // Skip merge commits (parent count > 1).
  const parents = run(['rev-list', '--parents', '-n', '1', sha], workspace).trim().split(/\s+/);
  if (parents.length > 2) return;

  let changed: string[];
  try {
    // Normal path: diff to parent
    changed = run(['diff', '--name-only', 'HEAD~1', 'HEAD'], workspace)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // First commit — no HEAD~1. Fall back to show --name-only HEAD
    const out = run(['show', '--name-only', '--format=', 'HEAD'], workspace);
    changed = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (changed.length === 0) return;

  const target = readCollectorTarget(opts.stateRoot);
  if (!target) return; // collector not up; silently skip

  const url = `http://${target.host ?? '127.0.0.1'}:${target.port}/commit-links`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit_sha: sha, workspace, changed_files: changed }),
    });
  } catch {
    // best-effort; don't block git
  }
}
