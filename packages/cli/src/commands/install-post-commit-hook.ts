import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BEGIN = '# >>> minspect managed >>>';
const END = '# <<< minspect managed <<<';

export interface InstallPostCommitOptions {
  repoRoot: string;
  aiHistoryBin: string; // absolute path to minspect binary
}

function normalizeBinPath(bin: string): string {
  // git's sh-on-Windows handles forward slashes well; convert backslashes.
  return bin.replace(/\\/g, '/');
}

function blockText(bin: string): string {
  const p = normalizeBinPath(bin);
  return [BEGIN, `"${p}" link-commit || true`, END].join('\n');
}

function stripBlock(content: string): string {
  // Remove any existing `# >>> minspect managed >>>` ... `# <<< minspect managed <<<` section.
  const re = new RegExp(`\\n?${escapeRegex(BEGIN)}[\\s\\S]*?${escapeRegex(END)}\\n?`, 'g');
  return content.replace(re, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface InstallPostCommitResult {
  path: string;
  created: boolean;
  backup?: string;
}

export function installPostCommitHook(opts: InstallPostCommitOptions): InstallPostCommitResult {
  const hooksDir = join(opts.repoRoot, '.git', 'hooks');
  const hookPath = join(hooksDir, 'post-commit');
  mkdirSync(dirname(hookPath), { recursive: true });

  const existed = existsSync(hookPath);
  let existingBody = '';
  let backup: string | undefined;
  if (existed) {
    existingBody = readFileSync(hookPath, 'utf8');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${hookPath}.bak.${ts}`;
    writeFileSync(backup, existingBody);
    existingBody = stripBlock(existingBody);
  }

  const shebang = existingBody.startsWith('#!') ? '' : '#!/bin/sh\n';
  const out = `${shebang}${existingBody.replace(/\n*$/, '\n')}${blockText(opts.aiHistoryBin)}\n`;
  writeFileSync(hookPath, out);
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows: chmod is a no-op; git-for-windows honors hooks regardless.
  }
  return { path: hookPath, created: !existed, backup };
}
