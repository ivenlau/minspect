import { useEffect, useRef, useState } from 'react';
import { getJson } from '../../api';
import { useLang } from '../../i18n';
import styles from './RevertModal.module.css';

export interface RevertTarget {
  kind: 'turn' | 'edit';
  id: string;
}

interface PlanFile {
  file_path: string;
  before_hash: string | null;
  after_hash: string;
  expected_current_hash: string;
  kind: 'restore' | 'delete';
}

interface RevertPlan {
  target_kind: 'turn' | 'edit';
  target_id: string;
  source_agent: string | null;
  files: PlanFile[];
  warnings: {
    codex_source: boolean;
    chain_broken_user_edits: Array<{ file_path: string; at_edit_id: string }>;
    later_edits_will_be_lost: Array<{
      file_path: string;
      edit_id: string;
      turn_id: string;
      turn_idx: number | null;
    }>;
  };
}

export interface RevertModalProps {
  target: RevertTarget;
  onClose: () => void;
}

// Ported from the vanilla legacy UI. Server stays read-only; the modal
// builds the `minspect revert --turn <id> --yes` command for the user to
// copy into their terminal. Codex-sourced sessions hide the command (hard
// block — apply_patch logs don't have enough info to revert safely).
export function RevertModal({ target, onClose }: RevertModalProps) {
  const { t } = useLang();
  const [plan, setPlan] = useState<RevertPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cmdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ignore = false;
    const url = `/api/revert/plan?${target.kind}=${encodeURIComponent(target.id)}`;
    getJson<RevertPlan>(url)
      .then((p) => {
        if (!ignore) setPlan(p);
      })
      .catch((e) => {
        if (!ignore) setError((e as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [target.id, target.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cmd = plan?.warnings.codex_source
    ? ''
    : `minspect revert --${target.kind} ${target.id} --yes`;

  const handleCopy = async () => {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Fallback: select the text so user can Ctrl+C.
      const node = cmdRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      {/* The semantic <dialog> element has show/showModal state — we manage
         visibility ourselves so stick with a div + ARIA. */}
      {/* biome-ignore lint/a11y/useSemanticElements: custom modal, not native <dialog> */}
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="revert-title">
        <h3 id="revert-title" className={styles.h3}>
          {target.kind === 'turn' ? t('revert.h3.turn') : t('revert.h3.edit')}{' '}
          <code>{target.id}</code>
        </h3>
        {error && <div className={styles.error}>{t('revert.fetchFailed', { msg: error })}</div>}
        {!plan && !error && <p className={styles.sub}>{t('common.loading')}</p>}
        {plan && (
          <>
            <p className={styles.sub}>
              {t('revert.source', { name: plan.source_agent ?? t('revert.unknown') })}
            </p>
            {plan.warnings.codex_source && (
              <div className={styles.error}>
                <strong>{t('revert.codexTitle')}</strong> {t('revert.codexPart1')}{' '}
                <code>apply_patch</code> {t('revert.codexPart2')} <code>git checkout</code>{' '}
                {t('revert.codexPart3')}
              </div>
            )}
            {plan.warnings.later_edits_will_be_lost.length > 0 && (
              <div className={styles.warn}>
                <strong>
                  {t('revert.laterEditsStrong', {
                    n: plan.warnings.later_edits_will_be_lost.length,
                  })}
                </strong>{' '}
                {t('revert.laterEditsRest')}{' '}
                {Array.from(
                  new Set(plan.warnings.later_edits_will_be_lost.map((l) => l.file_path)),
                ).join(', ')}
              </div>
            )}
            {plan.warnings.chain_broken_user_edits.length > 0 && (
              <div className={styles.warn}>
                <strong>{t('revert.userEditsStrong')}</strong> {t('revert.userEditsRest')}{' '}
                {Array.from(
                  new Set(plan.warnings.chain_broken_user_edits.map((c) => c.file_path)),
                ).join(', ')}
              </div>
            )}
            <div className={styles.files}>
              {plan.files.length === 0 ? (
                <span className={styles.kind}>{t('revert.noFiles')}</span>
              ) : (
                plan.files.map((f) => (
                  <div key={f.file_path} className={styles.fileRow}>
                    <span className={styles.kind}>[{f.kind}]</span> {f.file_path}
                  </div>
                ))
              )}
            </div>
            {cmd && (
              <>
                <p className={styles.sub} style={{ marginTop: 12 }}>
                  {t('revert.runInTerminal')}
                </p>
                <div className={styles.cmdRow}>
                  <div className={styles.cmd} ref={cmdRef}>
                    {cmd}
                  </div>
                  <button type="button" className={styles.btn} onClick={handleCopy}>
                    {copied ? t('revert.copiedBtn') : t('revert.copyBtn')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('revert.closeBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
