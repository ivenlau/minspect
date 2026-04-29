// Parses Codex `apply_patch` tool-call input into synthetic before/after
// content per file, so the collector's hunk pipeline can ingest it.
//
// Codex emits patches in a lightweight custom format:
//
//   *** Begin Patch
//   *** Update File: <absolute path>
//   @@
//   -old line
//   +new line
//    context line
//   @@
//   ...
//   *** Add File: <path>
//   +new content
//   *** Delete File: <path>
//   *** End Patch
//
// Because we don't have the full file contents, we synthesize before / after
// from the hunks themselves: `before` = context + '-' lines; `after` = context
// + '+' lines. Line numbers in hunks become relative to the changed region —
// that's an accepted trade-off (noted in adapter spec).

import type { FileEdit } from '@minspect/core';

export interface ParsedPatchFile {
  kind: 'update' | 'add' | 'delete';
  file_path: string;
  before: string | null;
  after: string;
}

export function parseApplyPatch(input: string): ParsedPatchFile[] {
  const files: ParsedPatchFile[] = [];
  // Trim a single trailing newline so we don't emit a spurious blank line at
  // the end of the last hunk. Inner blank lines (real context blanks) are
  // preserved.
  const normalized = input.endsWith('\n') ? input.slice(0, -1) : input;
  const lines = normalized.split('\n');

  let i = 0;
  while (i < lines.length && !lines[i]?.startsWith('*** Begin Patch')) i++;
  if (i >= lines.length) return files;
  i++; // past Begin Patch

  type Block = { kind: 'update' | 'add' | 'delete'; file: string; content: string[] };
  let current: Block | null = null;

  const flush = () => {
    if (!current) return;
    if (current.kind === 'update') {
      const before: string[] = [];
      const after: string[] = [];
      for (const ln of current.content) {
        if (ln === '@@' || ln.startsWith('@@ ')) {
          // hunk separator — insert ellipsis blank line on both sides so
          // collapsed hunks don't accidentally merge into one huge line.
          if (before.length > 0 && before[before.length - 1] !== '') before.push('');
          if (after.length > 0 && after[after.length - 1] !== '') after.push('');
          continue;
        }
        if (ln.startsWith('-')) before.push(ln.slice(1));
        else if (ln.startsWith('+')) after.push(ln.slice(1));
        else if (ln.startsWith(' ')) {
          before.push(ln.slice(1));
          after.push(ln.slice(1));
        } else if (ln.length === 0) {
          // blank line in hunk body — treat as context blank
          before.push('');
          after.push('');
        }
        // Other prefixes: ignore silently (e.g. '\\ No newline at end of file')
      }
      files.push({
        kind: 'update',
        file_path: current.file,
        before: before.join('\n'),
        after: after.join('\n'),
      });
    } else if (current.kind === 'add') {
      const added: string[] = [];
      for (const ln of current.content) {
        if (ln.startsWith('+')) added.push(ln.slice(1));
      }
      files.push({
        kind: 'add',
        file_path: current.file,
        before: null,
        after: added.join('\n'),
      });
    } else {
      files.push({
        kind: 'delete',
        file_path: current.file,
        before: null,
        after: '',
      });
    }
    current = null;
  };

  for (; i < lines.length; i++) {
    const ln = lines[i] ?? '';
    if (ln.startsWith('*** End Patch')) {
      flush();
      break;
    }
    const mUpd = /^\*\*\* Update File: (.+)$/.exec(ln);
    const mAdd = /^\*\*\* Add File: (.+)$/.exec(ln);
    const mDel = /^\*\*\* Delete File: (.+)$/.exec(ln);
    if (mUpd) {
      flush();
      current = { kind: 'update', file: (mUpd[1] ?? '').trim(), content: [] };
      continue;
    }
    if (mAdd) {
      flush();
      current = { kind: 'add', file: (mAdd[1] ?? '').trim(), content: [] };
      continue;
    }
    if (mDel) {
      flush();
      current = { kind: 'delete', file: (mDel[1] ?? '').trim(), content: [] };
      continue;
    }
    if (current) current.content.push(ln);
  }
  // File without explicit End Patch — still flush.
  flush();
  return files;
}

// Build FileEdit entries the collector can ingest. Deletes are emitted with
// after_content = '' (the diff tool will produce an all-deletions hunk).
export function toFileEdits(parsed: ParsedPatchFile[]): FileEdit[] {
  return parsed.map((p) => ({
    file_path: p.file_path,
    before_content: p.before,
    after_content: p.after,
  }));
}
