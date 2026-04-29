import { Clock } from 'lucide-react';
import { type SessionRow, usePoll } from '../api';
import { ClickRow } from '../components/ClickRow';
import { EmptyState } from '../components/EmptyState';
import { LiveDot } from '../components/Skeleton';
import { useLang } from '../i18n';
import { hrefFor, navigate } from '../router';
import styles from './TimelinePage.module.css';

interface Resp {
  sessions: SessionRow[];
}

// Transitional page: lists every session the collector knows about, newest
// first. Equivalent to what the vanilla UI showed at `/`. The Dashboard
// (card 23) replaces this as the default landing page.
export function TimelinePage() {
  const { t } = useLang();
  const { data, loading, error } = usePoll<Resp>('/api/sessions', 5000);

  // i18n-aware relative-time: keys in the dictionary supply language forms.
  function relTime(ts: number): string {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return t('timeline.sAgo', { n: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t('timeline.mAgo', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('timeline.hAgo', { n: h });
    const d = Math.floor(h / 24);
    return t('timeline.dAgo', { n: d });
  }

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.h1}>{t('timeline.title')}</h1>
        <p style={{ color: 'var(--danger)' }}>
          {t('timeline.failedToLoad', { msg: error.message })}
        </p>
      </div>
    );
  }

  const sessions = data?.sessions ?? [];

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.h1}>{t('timeline.title')}</h1>
        <p className={styles.sub}>{t('timeline.subtitle')}</p>
      </div>
      {sessions.length === 0 && !loading && (
        <EmptyState
          icon={Clock}
          title={t('timeline.emptyTitle')}
          subtitle={t('timeline.emptySub')}
        />
      )}
      <div className={styles.list}>
        {sessions.map((s) => (
          <ClickRow
            key={s.id}
            className={styles.row}
            onClick={() =>
              navigate(
                hrefFor({
                  kind: 'session',
                  workspace: s.workspace_id,
                  session: s.id,
                  tab: 'overview',
                }),
              )
            }
          >
            <span className={styles.agent}>{s.agent}</span>
            <span className={styles.codeId}>{s.id.slice(0, 8)}</span>
            {s.ended_at == null && <LiveDot />}
            <span className={styles.meta}>{s.workspace_id}</span>
            <span className={styles.spacer} />
            <span className={styles.meta}>{relTime(s.started_at)}</span>
          </ClickRow>
        ))}
      </div>
    </div>
  );
}
