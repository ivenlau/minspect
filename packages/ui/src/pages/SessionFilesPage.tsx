import { AlertCircle, FileText } from 'lucide-react';
import { usePoll } from '../api';
import { Card } from '../components/Card';
import { ClickRow } from '../components/ClickRow';
import { EmptyState } from '../components/EmptyState';
import { useLang } from '../i18n';
import { hrefFor, navigate } from '../router';
import styles from './SessionFilesPage.module.css';

export interface SessionFilesPageProps {
  workspace: string;
  session: string;
}

interface FileRow {
  file_path: string;
  edit_count: number;
  first: number;
  last: number;
}

interface Resp {
  files: FileRow[];
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SessionFilesPage({ workspace, session }: SessionFilesPageProps) {
  const { t } = useLang();
  const url = `/api/sessions/${encodeURIComponent(session)}/files`;
  const { data, error } = usePoll<Resp>(url, 10_000);
  const files = data?.files ?? [];
  const topEdits = files[0]?.edit_count ?? 1;
  const total = files.reduce((s, f) => s + f.edit_count, 0);

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('common.failedToLoad', { what: 'files' })}
        subtitle={error.message}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.hdr}>
        <h1 className={styles.title}>{t('sessionFiles.title')}</h1>
        <p className={styles.sub}>
          {files.length === 0
            ? t('sessionFiles.subtitleEmpty')
            : t('sessionFiles.subtitle', {
                files: files.length,
                edits: total,
                id: session.slice(0, 8),
              })}
        </p>
      </div>

      <Card title={t('sessionFiles.card')} meta={String(files.length)}>
        <div className={styles.list}>
          {files.length === 0 ? (
            <EmptyState icon={FileText} compact title={t('sessionFiles.emptyTitle')} />
          ) : (
            <>
              <div className={styles.hdrRow}>
                <span>{t('sessionFiles.tbl.file')}</span>
                <span>{t('sessionFiles.tbl.edits')}</span>
                <span>{t('sessionFiles.tbl.heat')}</span>
                <span>{t('sessionFiles.tbl.lastEdit')}</span>
              </div>
              {files.map((f) => (
                <ClickRow
                  key={f.file_path}
                  className={styles.row}
                  onClick={() => navigate(hrefFor({ kind: 'blame', workspace, file: f.file_path }))}
                  title={f.file_path}
                >
                  <span className={styles.path}>{f.file_path}</span>
                  <span className={styles.count}>{f.edit_count}</span>
                  <div className={styles.bar}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${Math.round((f.edit_count / topEdits) * 100)}%` }}
                    />
                  </div>
                  <span
                    className={styles.time}
                    title={`first ${fmtDate(f.first)}\nlast  ${fmtDate(f.last)}`}
                  >
                    {fmtTime(f.last)}
                  </span>
                </ClickRow>
              ))}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
