import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import { hrefFor, navigate } from '../../router';
import styles from '../session/ConfirmDeleteModal.module.css';

export interface ConfirmDeleteWorkspaceModalProps {
  workspacePath: string;
  onClose: () => void;
}

export function ConfirmDeleteWorkspaceModal({
  workspacePath,
  onClose,
}: ConfirmDeleteWorkspaceModalProps) {
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
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspacePath)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      }
      navigate(hrefFor({ kind: 'dashboard' }));
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  const name = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;

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
          {t('workspace.deleteConfirmTitle')}
        </h3>
        <p className={styles.message}>
          {t('workspace.deleteConfirmMessage', { name })}
        </p>
        <div className={styles.warn}>{t('workspace.deleteConfirmWarning')}</div>
        {error && (
          <div className={styles.error}>{t('workspace.deleteFailed', { msg: error })}</div>
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
            {deleting ? '...' : t('workspace.deleteConfirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
