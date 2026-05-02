import { useEffect, useState } from 'react';
import { getJson, postJson } from '../../api';
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

interface ExecuteResult {
  written: Array<{ file_path: string; action: string }>;
  skipped: Array<{ file_path: string; reason: string }>;
}

export interface RevertModalProps {
  target: RevertTarget;
  onClose: () => void;
}

export function RevertModal({ target, onClose }: RevertModalProps) {
  const { t } = useLang();
  const [plan, setPlan] = useState<RevertPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forceMode, setForceMode] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [driftDetected, setDriftDetected] = useState(false);

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
      if (e.key === 'Escape') {
        if (confirming) setConfirming(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirming]);

  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    setApplyError(null);
    setDriftDetected(false);
    try {
      const res = await postJson<ExecuteResult>('/api/revert/execute', {
        kind: target.kind,
        id: target.id,
        force: forceMode,
      });
      setResult(res);
      setForceMode(false);
      setConfirming(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('drift')) {
        setDriftDetected(true);
        setForceMode(true);
      } else {
        setApplyError(t('revert.applyError', { msg }));
      }
      // Stay on confirmation step so user can retry or cancel.
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (confirming) setConfirming(false);
          else onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (confirming) setConfirming(false);
          else onClose();
        }
      }}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: custom modal, not native <dialog> */}
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="revert-title">
        <h3 id="revert-title" className={styles.h3}>
          {confirming ? (
            t('revert.confirmTitle')
          ) : (
            <>
              {target.kind === 'turn' ? t('revert.h3.turn') : t('revert.h3.edit')}{' '}
              <code>{target.id}</code>
            </>
          )}
        </h3>
        {error && <div className={styles.error}>{t('revert.fetchFailed', { msg: error })}</div>}
        {!plan && !error && <p className={styles.sub}>{t('common.loading')}</p>}

        {/* --- Confirmation step --- */}
        {plan && confirming && (
          <>
            <p className={styles.sub}>{t('revert.confirmApply')}</p>
            <div className={styles.files}>
              {plan.files.map((f) => (
                <div key={f.file_path} className={styles.fileRow}>
                  <span className={styles.kind}>[{f.kind}]</span> {f.file_path}
                </div>
              ))}
            </div>
            {driftDetected && <div className={styles.warn}>{t('revert.driftDetected')}</div>}
            {applyError && <div className={styles.error}>{applyError}</div>}
            <label className={styles.forceRow}>
              <input
                type="checkbox"
                checked={forceMode}
                onChange={(e) => setForceMode(e.target.checked)}
              />
              {t('revert.forceLabel')}
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnAccent}
                onClick={handleApply}
                disabled={applying}
              >
                {applying ? t('revert.applying') : t('revert.confirmBtn')}
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setConfirming(false);
                  setApplyError(null);
                }}
                disabled={applying}
              >
                {t('revert.cancelBtn')}
              </button>
            </div>
          </>
        )}

        {/* --- Plan view (default) --- */}
        {plan && !confirming && (
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
            {result && (
              <div className={styles.success}>
                {t('revert.applySuccess', { n: result.written.length, m: result.skipped.length })}
              </div>
            )}
            {applyError && <div className={styles.error}>{applyError}</div>}
            <div className={styles.actions}>
              {plan && !plan.warnings.codex_source && !result && plan.files.length > 0 && (
                <button
                  type="button"
                  className={styles.btnAccent}
                  onClick={() => {
                    setForceMode(false);
                    setConfirming(true);
                  }}
                >
                  {t('revert.applyNow')}
                </button>
              )}
              <button type="button" className={styles.btn} onClick={onClose}>
                {t('revert.closeBtn')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
