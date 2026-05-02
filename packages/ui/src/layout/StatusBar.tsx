import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type QueueStats, getJson, postJson, usePoll } from '../api';
import { useLang } from '../i18n';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  leftSlot?: ReactNode;
}

interface BuildInfo {
  ui_hash: string;
  server_started_at: number;
  spawned_by?: 'user' | 'init' | 'hook';
}

interface PoisonEvent {
  filename: string;
  size_bytes: number;
  created_at: number;
  type: string | null;
  session_id: string | null;
}

// Always shows queue + poisoned counts on the right — a permanent reminder
// of system health. The poison-backlog incident earlier in the project was
// invisible precisely because these weren't surfaced.
//
// Also polls `/api/build-info` every 30 s and compares against whatever we
// saw at first load; if the daemon's `ui_hash` changes the tab is stale
// (developer rebuilt) and we surface a small "Reload" prompt.
export function StatusBar({ leftSlot }: StatusBarProps) {
  const { t } = useLang();
  const { data } = usePoll<QueueStats>('/api/queue-stats', 5000);
  const { data: build } = usePoll<BuildInfo>('/api/build-info', 30_000);
  const queue = data?.queue ?? 0;
  const poison = data?.poisoned ?? 0;

  const initialHashRef = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!build?.ui_hash) return;
    if (initialHashRef.current == null) {
      initialHashRef.current = build.ui_hash;
      return;
    }
    if (build.ui_hash !== initialHashRef.current) setStale(true);
  }, [build?.ui_hash]);

  return (
    <footer className={styles.bar}>
      <div>{leftSlot}</div>
      <div className={styles.spacer} />
      {stale && (
        <>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={styles.reloadBtn}
            title={t('status.reloadTip')}
          >
            {t('status.reload')}
          </button>
          <span className={styles.sep}>·</span>
        </>
      )}
      {build?.spawned_by === 'hook' && (
        <>
          <span className={`${styles.chip} ${styles.chipOk}`} title={t('status.spawnedByHookTip')}>
            {t('status.spawnedByHook')}
          </span>
          <span className={styles.sep}>·</span>
        </>
      )}
      <span className={`${styles.chip} ${queue === 0 ? styles.chipOk : styles.chipWarn}`}>
        {t('status.queue')} {queue}
      </span>
      {poison > 0 && (
        <>
          <span className={styles.sep}>·</span>
          <PoisonChip count={poison} />
        </>
      )}
    </footer>
  );
}

// Clickable poisoned-count chip that opens an overlay listing the events.
// Read-only — clearing them is a CLI operation (`minspect vacuum --clear-poison`).
function PoisonChip({ count }: { count: number }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PoisonEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const loadEvents = () => {
    setEvents(null);
    setErr(null);
    getJson<{ events: PoisonEvent[] }>('/api/queue/poison')
      .then((r) => setEvents(r.events))
      .catch((e) => setErr((e as Error).message));
  };

  useEffect(() => {
    if (!open) return;
    setPurgeMsg(null);
    loadEvents();
  }, [open]);

  const handlePurge = async () => {
    setPurging(true);
    setPurgeMsg(null);
    try {
      const res = await postJson<{ purged: number }>('/api/queue/purge', {});
      setPurgeMsg(t('status.purgeSuccess', { n: res.purged }));
      loadEvents();
    } catch (e) {
      setPurgeMsg(t('status.purgeFailed', { msg: (e as Error).message }));
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${styles.chip} ${styles.chipWarn} ${styles.chipBtn}`}
        onClick={() => setOpen(true)}
      >
        {t('status.poisoned')} {count}
      </button>
      {open && (
        <div
          className={styles.poisonBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          role="presentation"
        >
          <div className={styles.poisonPanel}>
            <div className={styles.poisonHdr}>
              <strong>{t('status.quarantinedHeader', { n: count })}</strong>
              <button
                type="button"
                className={styles.purgeBtn}
                onClick={handlePurge}
                disabled={purging}
              >
                {purging ? '...' : t('status.purgeBtn')}
              </button>
              {purgeMsg && <span className={styles.poisonSub}>{purgeMsg}</span>}
              <button type="button" className={styles.poisonClose} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className={styles.poisonBody}>
              {err && (
                <div className={styles.poisonEmpty}>
                  {t('status.failedToLoadInline', { msg: err })}
                </div>
              )}
              {!events && !err && <div className={styles.poisonEmpty}>{t('common.loading')}</div>}
              {events && events.length === 0 && (
                <div className={styles.poisonEmpty}>{t('common.empty')}</div>
              )}
              {events?.map((ev) => (
                <div key={ev.filename} className={styles.poisonRow}>
                  <span className={styles.poisonType}>{ev.type ?? t('common.none')}</span>
                  <span className={styles.poisonSess}>{ev.session_id?.slice(0, 8) ?? '—'}</span>
                  <span className={styles.poisonWhen}>
                    {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
                  </span>
                  <span className={styles.poisonName} title={ev.filename}>
                    {ev.filename}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
