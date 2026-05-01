import { diffLines, type Change } from 'diff';
import { GitCompareArrows, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../../i18n';
import type { BlameEdit, BlameTurn } from '../../pages/BlamePage';
import styles from './CompareModal.module.css';

export interface CompareModalProps {
  editLeft: BlameEdit;
  editRight: BlameEdit;
  turns: BlameTurn[];
  workspace: string;
  file: string;
  onClose: () => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

// Build aligned left/right line arrays from diff output.
function buildSideBySide(changes: Change[]): { left: DiffLine[]; right: DiffLine[] } {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  for (const c of changes) {
    const lines = c.value.replace(/\n$/, '').split('\n');
    if (c.added) {
      for (const l of lines) {
        left.push({ type: 'unchanged', content: '' });
        right.push({ type: 'added', content: l });
      }
    } else if (c.removed) {
      for (const l of lines) {
        left.push({ type: 'removed', content: l });
        right.push({ type: 'unchanged', content: '' });
      }
    } else {
      for (const l of lines) {
        left.push({ type: 'unchanged', content: l });
        right.push({ type: 'unchanged', content: l });
      }
    }
  }
  return { left, right };
}

function relTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 0) return new Date(ts).toLocaleString();
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function CompareModal({
  editLeft,
  editRight,
  turns,
  file,
  onClose,
}: CompareModalProps) {
  const { t } = useLang();
  const [leftText, setLeftText] = useState<string | null>(null);
  const [rightText, setRightText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    async function fetchBlobs() {
      try {
        const [lRes, rRes] = await Promise.all([
          fetch(`/api/blobs/${editLeft.after_hash}`, { signal: ac.signal }),
          fetch(`/api/blobs/${editRight.after_hash}`, { signal: ac.signal }),
        ]);
        if (!lRes.ok || !rRes.ok) {
          setError(t('blame.compareNoContent'));
          return;
        }
        const [lText, rText] = await Promise.all([lRes.text(), rRes.text()]);
        if (!ac.signal.aborted) {
          setLeftText(lText);
          setRightText(rText);
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(t('blame.compareNoContent'));
      }
    }
    fetchBlobs();
    return () => ac.abort();
  }, [editLeft.after_hash, editRight.after_hash, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const turnL = turns.find((tr) => tr.id === editLeft.turn_id);
  const turnR = turns.find((tr) => tr.id === editRight.turn_id);

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const isLoading = leftText === null || rightText === null;
  const hasData = leftText !== null && rightText !== null;

  let additions = 0;
  let removals = 0;
  let leftLines: DiffLine[] = [];
  let rightLines: DiffLine[] = [];
  if (hasData && !error) {
    const changes = diffLines(leftText, rightText);
    const side = buildSideBySide(changes);
    leftLines = side.left;
    rightLines = side.right;
    for (const l of leftLines) if (l.type === 'removed') removals++;
    for (const r of rightLines) if (r.type === 'added') additions++;
  }

  return (
    <div ref={backdropRef} className={styles.backdrop} onClick={onBackdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={t('blame.compareTitle')}>
        <div className={styles.header}>
          <GitCompareArrows size={15} />
          <span className={styles.headerTitle}>{t('blame.compareTitle')}</span>
          {hasData && !error && (
            <span className={styles.stats}>
              <span className={styles.statAdded}>+{additions}</span>
              <span className={styles.statRemoved}>-{removals}</span>
            </span>
          )}
          <span className={styles.headerSpacer} />
          <span className={styles.headerTitle} style={{ fontWeight: 400, fontSize: 'var(--fs-11)', color: 'var(--text-2)' }}>
            {file}
          </span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.labels}>
          <div className={styles.label}>
            <span className={`${styles.labelTag} ${styles.labelTagLeft}`}>{t('blame.compareLeft')}</span>
            <span>{relTime(editLeft.created_at)}</span>
            <span>·</span>
            <span>{editLeft.session_id.slice(0, 6)} #{turnL?.idx ?? '?'}</span>
            {turnL?.user_prompt && <span>· {turnL.user_prompt.slice(0, 60)}</span>}
          </div>
          <div className={styles.label}>
            <span className={`${styles.labelTag} ${styles.labelTagRight}`}>{t('blame.compareRight')}</span>
            <span>{relTime(editRight.created_at)}</span>
            <span>·</span>
            <span>{editRight.session_id.slice(0, 6)} #{turnR?.idx ?? '?'}</span>
            {turnR?.user_prompt && <span>· {turnR.user_prompt.slice(0, 60)}</span>}
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {isLoading && !error && <div className={styles.loading}>{t('common.loading')}</div>}
        {hasData && !error && (
          <div className={styles.body}>
            <div className={styles.pane}>
              {leftLines.map((l, i) => (
                <div key={i} className={`${styles.line} ${l.type === 'removed' ? styles.lineRemoved : ''} ${l.type === 'unchanged' && !l.content ? styles.lineEmpty : ''}`}>
                  <span className={styles.lineNum}>{l.content ? i + 1 : ''}</span>
                  <span className={styles.lineContent}>{l.content || (l.type === 'unchanged' ? ' ' : '')}</span>
                </div>
              ))}
            </div>
            <div className={styles.pane}>
              {rightLines.map((r, i) => (
                <div key={i} className={`${styles.line} ${r.type === 'added' ? styles.lineAdded : ''} ${r.type === 'unchanged' && !r.content ? styles.lineEmpty : ''}`}>
                  <span className={styles.lineNum}>{r.content ? i + 1 : ''}</span>
                  <span className={styles.lineContent}>{r.content || (r.type === 'unchanged' ? ' ' : '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
