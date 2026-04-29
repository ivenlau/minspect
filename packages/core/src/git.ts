import { execFileSync } from 'node:child_process';
import type { GitState } from './types.js';

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Returns null if `cwd` is not inside a git work tree.
// For a fresh repo with no commits, head is '' but the call still succeeds.
export function readGitState(cwd: string): GitState | null {
  try {
    runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    return null;
  }

  let head = '';
  try {
    head = runGit(['rev-parse', 'HEAD'], cwd).trim();
  } catch {
    // No commits yet — leave head empty.
  }

  const branch = runGit(['branch', '--show-current'], cwd).trim();
  const status = runGit(['status', '--porcelain'], cwd);

  return {
    branch,
    head,
    dirty: status.length > 0,
  };
}
