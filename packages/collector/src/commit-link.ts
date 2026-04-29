import type { Store } from './store.js';

export interface LinkCommitRequest {
  commit_sha: string;
  workspace: string;
  changed_files: string[];
  time_window_ms?: number; // how far back to look for matching edits (default 24h)
  confidence?: number; // attribution confidence; default 1.0
}

export interface LinkCommitResult {
  linked: number;
  edit_ids: string[];
}

// Normalize path separators for comparison only — we never rewrite what's
// stored in the DB. `linkCommit` has to bridge two sources with different
// conventions: the Claude Code hook (OS-native, so backslashes on Windows)
// writes edits.file_path / workspace_id as-is; git (what the post-commit
// hook hands us) normalizes to forward slashes. Plus git diff returns
// repo-relative paths while edits store absolute paths.
function slashify(s: string): string {
  return s.replace(/\\/g, '/');
}

// Build the set of absolute-path candidates a single git-relative file
// could correspond to in the DB. Covers all combinations of: workspace
// slash form, join-character, and the raw value (if caller passed abs).
function candidatesFor(workspace: string, relFile: string): string[] {
  const wsSlash = slashify(workspace);
  const fileSlash = slashify(relFile);
  return Array.from(
    new Set([
      relFile,
      `${workspace}/${relFile}`,
      `${workspace}\\${relFile}`,
      `${wsSlash}/${fileSlash}`,
    ]),
  );
}

// Associate a git commit with edits that touched the same files recently.
// Pure heuristic for MVP: edits within `time_window_ms` on the same file
// (compared separator-agnostically) in the same workspace are linked to
// this commit_sha.
export function linkCommit(store: Store, req: LinkCommitRequest): LinkCommitResult {
  if (req.changed_files.length === 0) return { linked: 0, edit_ids: [] };
  const window = req.time_window_ms ?? 24 * 60 * 60 * 1000;
  const since = Date.now() - window;
  const confidence = req.confidence ?? 1.0;

  // Flatten every (workspace, rel-file) pair into the list of candidate
  // absolute paths. SQL side uses `REPLACE(path, '\', '/')` on both sides
  // so stored OS-native paths line up with git's forward-slash paths.
  const candidates = req.changed_files.flatMap((f) => candidatesFor(req.workspace, f));
  const placeholders = candidates.map(() => "REPLACE(?, '\\', '/')").join(',');
  const rows = store.db
    .prepare(
      `SELECT id, file_path
       FROM edits
       WHERE REPLACE(workspace_id, '\\', '/') = ?
         AND created_at >= ?
         AND REPLACE(file_path, '\\', '/') IN (${placeholders})
         AND id NOT IN (SELECT edit_id FROM commit_links WHERE commit_sha = ?)`,
    )
    .all(slashify(req.workspace), since, ...candidates, req.commit_sha) as Array<{
    id: string;
    file_path: string;
  }>;

  const ins = store.db.prepare(
    `INSERT OR IGNORE INTO commit_links (commit_sha, workspace_id, edit_id, confidence)
     VALUES (?, ?, ?, ?)`,
  );
  const txn = store.db.transaction((editIds: string[]) => {
    for (const id of editIds) ins.run(req.commit_sha, req.workspace, id, confidence);
  });
  const editIds = rows.map((r) => r.id);
  txn(editIds);
  return { linked: editIds.length, edit_ids: editIds };
}
