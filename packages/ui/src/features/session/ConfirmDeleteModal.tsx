import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import styles from './ConfirmDeleteModal.module.css';

export interface ConfirmDeleteModalProps {
  sessionId: string;
  agent: string;
  startedAt: number | null;
  onClose: () => void;
  onDeleted: () => void;
}

export function ConfirmDeleteModal({
  sessionId,
  agent,
  startedAt,
  onClose,
  onDeleted,
}: ConfirmDeleteModalProps) {
  const { t } = useLang();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      }
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
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
      {/* biome-ignore lint/a11y/useSemanticElements: custom modal */}
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h3 id="delete-title" className={styles.h3}>
          {t('sessionOverview.deleteConfirmTitle')}
        </h3>
        <p className={styles.message}>
          {t('sessionOverview.deleteConfirmMessage', {
            id: sessionId.slice(0, 8),
            agent,
          })}
        </p>
        <div className={styles.warn}>{t('sessionOverview.deleteConfirmWarning')}</div>
        {error && (
          <div className={styles.error}>{t('sessionOverview.deleteFailed', { msg: error })}</div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={deleting}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '…' : t('sessionOverview.deleteConfirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
