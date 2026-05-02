import { createHash } from 'node:crypto';

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface RevertPlanFile {
  file_path: string;
  workspace_id: string;
  before_hash: string | null;
  after_hash: string;
  expected_current_hash: string;
  kind: 'restore' | 'delete';
}

export interface RevertWarnings {
  codex_source: boolean;
  chain_broken_user_edits: Array<{ file_path: string; at_edit_id: string }>;
  later_edits_will_be_lost: Array<{
    file_path: string;
    edit_id: string;
    turn_id: string;
    turn_idx: number | null;
  }>;
}

export interface RevertPlan {
  target_kind: 'turn' | 'edit';
  target_id: string;
  source_agent: string | null;
  files: RevertPlanFile[];
  warnings: RevertWarnings;
}

export interface RevertFileResult {
  file_path: string;
  action: 'restored' | 'deleted';
}

export interface DriftEntry {
  file_path: string;
  expected: string;
  actual: string;
}

export interface RevertResult {
  written: RevertFileResult[];
  skipped: Array<{ file_path: string; reason: string }>;
}

/** Check which files have drifted from their expected hash. */
export function checkDrift(
  files: RevertPlanFile[],
  readContent: (path: string) => string | null,
): DriftEntry[] {
  const drift: DriftEntry[] = [];
  for (const f of files) {
    const content = readContent(f.file_path);
    if (content === null) {
      // File missing on disk
      if (f.expected_current_hash !== sha256('')) {
        drift.push({
          file_path: f.file_path,
          expected: f.expected_current_hash,
          actual: '<missing>',
        });
      }
      continue;
    }
    const actual = sha256(content);
    if (actual !== f.expected_current_hash) {
      drift.push({ file_path: f.file_path, expected: f.expected_current_hash, actual });
    }
  }
  return drift;
}

/** Apply a revert plan: write blobs back to disk, delete AI-created files. */
export async function applyRevert(
  plan: RevertPlan,
  fetchBlob: (hash: string) => Promise<string>,
  writeFile: (path: string, content: string) => void,
  deleteFile: (path: string) => void,
): Promise<RevertResult> {
  const written: RevertFileResult[] = [];
  const skipped: Array<{ file_path: string; reason: string }> = [];

  for (const f of plan.files) {
    if (f.kind === 'delete') {
      try {
        deleteFile(f.file_path);
        written.push({ file_path: f.file_path, action: 'deleted' });
      } catch (e) {
        skipped.push({ file_path: f.file_path, reason: (e as Error).message });
      }
      continue;
    }
    if (!f.before_hash) {
      skipped.push({ file_path: f.file_path, reason: 'no before_hash recorded' });
      continue;
    }
    let content: string;
    try {
      content = await fetchBlob(f.before_hash);
    } catch (e) {
      skipped.push({
        file_path: f.file_path,
        reason: `blob ${f.before_hash.slice(0, 8)} unavailable: ${(e as Error).message}`,
      });
      continue;
    }
    try {
      writeFile(f.file_path, content);
      written.push({ file_path: f.file_path, action: 'restored' });
    } catch (e) {
      skipped.push({ file_path: f.file_path, reason: (e as Error).message });
    }
  }

  return { written, skipped };
}
