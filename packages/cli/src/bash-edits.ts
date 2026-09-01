import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Attribution of file modifications made through the Bash tool (heredoc
// `cat >`, sed -i, tee, git apply, …). The PostToolUse payload for Bash
// carries no file_path, so we derive the changed set from the git
// worktree: the session state holds a snapshot (porcelain status + cached
// contents of dirty/untracked paths), and each PostToolUse(Bash) diffs a
// fresh snapshot against it. Same mechanism backs non-Bash fallbacks —
// anywhere the file-editing tools left no trace.

export interface WorktreeSnapshot {
  // repo root the paths are relative to
  root: string;
  // absolute path → two-char porcelain XY code
  status: Record<string, string>;
  // absolute path → repo-root-relative path (for `git show :path`)
  rels: Record<string, string>;
  // cached disk contents for dirty / untracked paths (capped) — the exact
  // "before" for the next diff
  contents: Record<string, string>;
}

// Caps so a pathological worktree can't blow up the session state file or
// the hook's time budget. Overflow paths fall back to the index version
// of a file as its before-content.
const MAX_CACHED_PATHS = 400;
const MAX_CACHED_BYTES = 12 * 1024 * 1024;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Repo root for cwd, or null outside a work tree.
export function repoRoot(cwd: string): string | null {
  try {
    const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
    return root || null;
  } catch {
    return null;
  }
}

function readCached(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null; // deleted / unreadable — nothing to cache
  }
}

// Snapshot the worktree: porcelain status plus cached contents of every
// dirty / untracked path (within caps). Returns null outside a git repo.
export function snapshotWorktree(cwd: string): WorktreeSnapshot | null {
  const root = repoRoot(cwd);
  if (!root) return null;
  let out: string;
  try {
    out = git(root, ['status', '--porcelain=v1', '-z']);
  } catch {
    return null;
  }
  const status: Record<string, string> = {};
  const rels: Record<string, string> = {};
  const contents: Record<string, string> = {};
  // -z entries: "XY path\0"; rename/copy entries append the original path
  // as a second \0-separated field. Paths are relative to the repo root.
  const parts = out.split('\0');
  let budget = MAX_CACHED_BYTES;
  let cachedCount = 0;
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const rel = entry.slice(3);
    if (!rel) continue;
    if (xy.includes('R') || xy.includes('C')) i++; // skip the rename-source field
    const abs = join(root, rel);
    status[abs] = xy;
    rels[abs] = rel;
    if (xy.includes('D')) continue; // nothing on disk to cache
    if (cachedCount >= MAX_CACHED_PATHS || budget <= 0) continue;
    const content = readCached(abs);
    if (content === null || content.length > budget) continue;
    contents[abs] = content;
    budget -= content.length;
    cachedCount++;
  }
  return { root, status, rels, contents };
}

export interface BashFileEdit {
  file_path: string;
  before_content: string | null;
  after_content: string;
}

// Before-content resolution for a changed path, in order of exactness:
// 1. cached content from the previous snapshot — exact pre-call bytes for
//    anything that was dirty/untracked before (rewrites of the same file
//    across calls chain through this);
// 2. absent from the previous snapshot + now untracked or staged-add →
//    created by this call → null (matches AI-created-file semantics);
// 3. absent from the previous snapshot + tracked now → the file was clean
//    before (porcelain never lists clean files) → the index version via
//    `cat-file --filters` is the exact pre-call content (the filter
//    applies the same CRLF conversion as the worktree, avoiding phantom
//    whole-file diffs on autocrlf checkouts);
// 4. listed before but content uncached (caps hit) → 'skip': the file
//    existed, so faking a creation or an index baseline would mislead
//    revert — better to not attribute this edit.
function resolveBefore(
  before: WorktreeSnapshot,
  after: WorktreeSnapshot,
  abs: string,
  afterContent: string,
): string | null | 'skip' {
  const cached = before.contents[abs];
  if (cached !== undefined) return cached;
  if (before.status[abs] !== undefined) return 'skip';
  const xy = after.status[abs] ?? '';
  if (xy.includes('?') || xy.includes('A')) return null;
  const rel = after.rels[abs];
  if (rel === undefined) return 'skip';
  try {
    // No -p: it conflicts with --filters. With a :path object spec the
    // filter lookup uses that path, and the blob prints raw (smudged).
    const raw = git(after.root, ['cat-file', '--filters', `:${rel}`]);
    // Align EOLs with the on-disk file so the recorded pair reflects the
    // actual pre-call bytes: a checked-out CRLF file smudges to CRLF
    // (already aligned), while an LF-written file edited through Bash
    // must not be recorded as a whole-file EOL rewrite.
    if (raw) {
      const afterCrlf = afterContent.includes('\r\n');
      const rawCrlf = raw.includes('\r\n');
      if (afterCrlf && !rawCrlf) return raw.replace(/\n/g, '\r\n');
      if (!afterCrlf && rawCrlf) return raw.replace(/\r\n/g, '\n');
    }
    return raw;
  } catch {
    return 'skip';
  }
}

// Changed files between two snapshots. Deletions are skipped (v1: the
// edits model has no "file removed" representation). Rewrites of
// already-dirty/untracked paths are detected by comparing cached
// contents, so a Bash call that rewrites the same file twice still
// yields two exact before/after pairs.
export function diffWorktree(before: WorktreeSnapshot, after: WorktreeSnapshot): BashFileEdit[] {
  const edits: BashFileEdit[] = [];
  for (const [abs, xy] of Object.entries(after.status)) {
    if (xy.includes('D')) continue; // deleted — not representable in v1
    const afterContent = after.contents[abs];
    if (afterContent === undefined) continue;
    const resolved = resolveBefore(before, after, abs, afterContent);
    if (resolved === 'skip') continue;
    const beforeContent = resolved;
    if (beforeContent === afterContent) continue;
    edits.push({ file_path: abs, before_content: beforeContent, after_content: afterContent });
  }
  return edits;
}
