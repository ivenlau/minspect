import { GitCompareArrows, History, PencilLine, X } from 'lucide-react';
import { type MouseEvent, useEffect, useRef } from 'react';
import { t as tStatic, useLang } from '../../i18n';
import type { BlameEdit, BlameTurn } from '../../pages/BlamePage';
import styles from './RevisionsPopover.module.css';

export interface RevisionsPopoverProps {
  open: boolean;
  edits: BlameEdit[];
  turns: BlameTurn[];
  activeEditId: string | null;
  onHover: (editId: string | null) => void;
  onSelect: (editId: string) => void;
  onClose: () => void;
  selectedForCompare: Set<string>;
  onToggleCompare: (editId: string) => void;
  onOpenCompare: () => void;
}

// Relative-time formatter tailored for a few seconds → a few days. Anything
// older than a week falls back to the absolute date so the popover stays
// readable for long-lived files. Uses the module-level `tStatic` so it can
// be called from non-component helpers (tests / util chains).
function relTime(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < 0) return new Date(ts).toLocaleString();
  const s = Math.floor(delta / 1000);
  if (s < 60) return tStatic('common.relTime.sAgo', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return tStatic('common.relTime.mAgo', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tStatic('common.relTime.hAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d === 1) return tStatic('common.relTime.yesterday');
  if (d < 7) return tStatic('common.relTime.dAgo', { n: d });
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// File-centric timeline of every AI edit that touched the current file.
// Anchored below the "revisions" toolbar button. Doesn't need a new API —
// /api/blame already returns both edits[] and turns[], and line-to-edit
// attribution is in blame[]. Hover previews a revision without scrolling;
// click focuses it (parent scrolls blame to the first affected line and
// paints a persistent highlight).
export function RevisionsPopover({
  open,
  edits,
  turns,
  activeEditId,
  onHover,
  onSelect,
  onClose,
  selectedForCompare,
  onToggleCompare,
  onOpenCompare,
}: RevisionsPopoverProps) {
  const { t } = useLang();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Esc. The parent already toggles via the
  // button click; this just handles "click anywhere else to dismiss".
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const turnById = new Map(turns.map((turn) => [turn.id, turn] as const));
  const sorted = [...edits].sort((a, b) => b.created_at - a.created_at);
  // `sorted[0]` is the newest edit, i.e. the live / "current" state. Mark it
  // so the user can tell at a glance which row = "what I see without the
  // revision viewer" (card 52).
  const currentEditId = sorted[0]?.id ?? null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div ref={rootRef} className={styles.popover} onMouseDown={stop}>
      <div className={styles.header}>
        <History size={12} className={styles.headerIcon} />
        <span>{t('blame.revisionsHeader', { n: sorted.length })}</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X size={12} />
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className={styles.empty}>{t('blame.revisionsEmpty')}</div>
      ) : (
        <>
          <div className={styles.list}>
            {sorted.map((e) => {
              const turn = turnById.get(e.turn_id);
              const prompt = (turn?.user_prompt ?? '').trim();
              const isActive = activeEditId === e.id;
              const isChecked = selectedForCompare.has(e.id);
              return (
                <div key={e.id} className={styles.rowWrap}>
                  <label className={styles.checkboxWrap} title={t('blame.compareCheckboxLabel')}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isChecked}
                      onChange={() => onToggleCompare(e.id)}
                    />
                  </label>
                  <button
                    type="button"
                    className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                    onMouseEnter={() => onHover(e.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(e.id)}
                  >
                    <div className={styles.rowHdr}>
                      <PencilLine size={11} className={styles.rowIcon} />
                      <span className={styles.rowTime}>{relTime(e.created_at)}</span>
                      <span className={styles.rowSep}>·</span>
                      <span className={styles.rowId}>
                        {e.session_id.slice(0, 6)} #{turn?.idx ?? '?'}
                      </span>
                      <span className={styles.rowSpacer} />
                      {e.id === currentEditId && (
                        <span className={styles.rowCurrent}>{t('blame.revisionCurrent')}</span>
                      )}
                      <span className={styles.rowHunks}>
                        {t('common.hunks', { n: e.hunk_count })}
                      </span>
                    </div>
                    <div className={styles.rowPrompt} title={prompt}>
                      {prompt || t('blame.revisionsNoPrompt')}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          {selectedForCompare.size === 2 && (
            <div className={styles.compareFooter}>
              <button type="button" className={styles.compareBtn} onClick={onOpenCompare}>
                <GitCompareArrows size={13} />
                {t('blame.compareSelected', { n: 2 })}
              </button>
            </div>
          )}
          {selectedForCompare.size < 2 && (
            <div className={styles.compareHint}>{t('blame.compareSelectHint')}</div>
          )}
        </>
      )}
    </div>
  );
}

// Map an edit id to the set of line numbers currently attributed to it in
// the blame table. Exported so tests / future features can re-use.
export function linesForEdit(
  blame: Array<{ line_no: number; edit_id: string }>,
  editId: string,
): number[] {
  const out: number[] = [];
  for (const b of blame) if (b.edit_id === editId) out.push(b.line_no);
  return out;
}

// Exported for tests.
export { relTime as _relTime };
