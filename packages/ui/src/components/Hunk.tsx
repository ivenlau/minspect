import styles from './Hunk.module.css';

export interface HunkData {
  new_start: number;
  new_count: number;
  old_text: string | null;
  new_text: string | null;
  explanation?: string | null;
}

export interface HunkProps {
  hunk: HunkData;
  oldStart?: number | null;
  oldCount?: number | null;
  // Context label shown in the @@ header (e.g. "registerApi(app, store)").
  context?: string;
}

function splitLines(s: string | null | undefined): string[] {
  if (!s) return [];
  // Drop a trailing empty line caused by a final newline — visually it's
  // never useful in diff output.
  const lines = s.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// A single diff hunk rendered the GitHub way: minus lines first, then plus
// lines, each tinted with the corresponding background. Matches the Pencil
// mockup's diff block.
export function Hunk({ hunk, oldStart, oldCount, context }: HunkProps) {
  const dels = splitLines(hunk.old_text);
  const adds = splitLines(hunk.new_text);
  const osStart = oldStart ?? null;
  const osCount = oldCount ?? 0;
  const headTxt =
    osStart == null
      ? `@@ new file · +${hunk.new_count} @@${context ? ` ${context}` : ''}`
      : `@@ -${osStart},${osCount} +${hunk.new_start},${hunk.new_count} @@${context ? ` ${context}` : ''}`;

  return (
    <div className={styles.hunk}>
      <div className={styles.head}>{headTxt}</div>
      <div className={styles.body}>
        {dels.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: line position is stable within a hunk
            key={`d${i}`}
            className={`${styles.row} ${styles.del}`}
          >
            <span className={styles.ln}>{(osStart ?? 0) + i}</span>
            <span className={`${styles.sign} ${styles.signDel}`}>−</span>
            <span className={styles.code}>{line}</span>
          </div>
        ))}
        {adds.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: line position is stable within a hunk
            key={`a${i}`}
            className={`${styles.row} ${styles.add}`}
          >
            <span className={styles.ln}>{hunk.new_start + i}</span>
            <span className={`${styles.sign} ${styles.signAdd}`}>+</span>
            <span className={styles.code}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
