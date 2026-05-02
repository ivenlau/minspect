import { AlertCircle, Check, MessageSquare, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type RefreshResult, postJson, usePoll } from '../api';
import { Card } from '../components/Card';
import { ClickRow } from '../components/ClickRow';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDeleteModal } from '../features/session/ConfirmDeleteModal';
import type { ReviewResp, ReviewTurn } from '../features/session/types';
import { useLang } from '../i18n';
import { hrefFor, navigate } from '../router';
import styles from './SessionOverviewPage.module.css';

export interface SessionOverviewPageProps {
  workspace: string;
  session: string;
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// Maps a tool name to a dot class. Rough bucketing — just enough to let a
// user eyeball "this turn did file edits vs ran bash vs mostly read files".
function dotClassFor(toolName: string | null | undefined): string {
  if (!toolName) return styles.dotOther;
  const t = toolName.toLowerCase();
  if (t === 'edit' || t === 'multiedit' || t === 'write' || t === 'apply_patch') {
    return styles.dotEdit;
  }
  if (t.startsWith('bash') || t === 'shell' || t === 'shell_command') return styles.dotBash;
  if (t === 'read' || t === 'glob' || t === 'grep') return styles.dotRead;
  return styles.dotOther;
}

function toolCallCount(t: ReviewTurn): Array<{ id: string; tool: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; tool: string | null }> = [];
  for (const e of t.edits) {
    const key = e.tool_call_id ?? `anon-${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, tool: e.tool_name ?? null });
  }
  return out;
}

export function SessionOverviewPage({ workspace, session }: SessionOverviewPageProps) {
  const { t } = useLang();
  const [showDelete, setShowDelete] = useState(false);
  const [resumeState, setResumeState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  const handleResume = async () => {
    setResumeState('idle');
    setResumeError(null);
    try {
      const r = await postJson<{ ok: boolean; command: string }>(
        `/api/sessions/${encodeURIComponent(session)}/resume`,
      );
      if (r.ok) {
        setResumeState('ok');
        if (resumeTimer.current) clearTimeout(resumeTimer.current);
        resumeTimer.current = setTimeout(() => setResumeState('idle'), 2000);
      }
    } catch (e) {
      setResumeState('error');
      setResumeError((e as Error).message);
    }
  };
  const url = `/api/review?session=${encodeURIComponent(session)}`;
  const { data, error } = usePoll<ReviewResp>(url, 10_000);
  const turns = data?.turns ?? [];

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('common.failedToLoad', { what: 'session' })}
        subtitle={error.message}
      />
    );
  }

  const started = turns[0]?.started_at ?? null;
  const ended = turns.reduce(
    (acc, t) => (t.ended_at != null && t.ended_at > (acc ?? 0) ? t.ended_at : acc),
    null as number | null,
  );
  const totalEdits = turns.reduce((s, t) => s + t.edits.length, 0);
  const touchedFiles = new Set(turns.flatMap((t) => t.edits.map((e) => e.file_path))).size;
  const dur = started && ended ? fmtDuration(ended - started) : '—';

  const agent = data?.agent ?? 'unknown';

  return (
    <div className={styles.page}>
      <div className={styles.hdr}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {t('sessionOverview.sessionTitle', { id: session.slice(0, 8) })}
          </h1>
          {(agent === 'claude-code' || agent === 'codex' || agent === 'opencode') && (
            <button
              type="button"
              className={styles.resumeBtn}
              onClick={handleResume}
              title={t('sessionOverview.resumeSession')}
            >
              {resumeState === 'ok' ? <Check size={14} /> : <Play size={14} />}
            </button>
          )}
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={() => setShowDelete(true)}
            title={t('sessionOverview.deleteSession')}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip}>{session}</span>
          <span>·</span>
          <a href={hrefFor({ kind: 'workspace', workspace })}>{workspace}</a>
          {started && (
            <>
              <span>·</span>
              <span>{new Date(started).toLocaleString()}</span>
            </>
          )}
          <span>·</span>
          <span>{t('sessionOverview.duration', { label: dur })}</span>
        </div>
        {resumeError && (
          <span className={styles.resumeError}>
            {t('sessionOverview.resumeFailed', { msg: resumeError })}
          </span>
        )}
      </div>

      <div className={styles.statRow}>
        <Stat label={t('sessionOverview.stat.turns')} value={turns.length} />
        <Stat label={t('sessionOverview.stat.edits')} value={totalEdits} />
        <Stat label={t('sessionOverview.stat.filesTouched')} value={touchedFiles} />
        <Stat label={t('sessionOverview.stat.duration')} value={dur} />
      </div>

      <Card title={t('sessionOverview.turnTimeline')} meta={t('common.turns', { n: turns.length })}>
        <div className={styles.turnList} style={{ margin: 'calc(-1 * var(--sp-4))' }}>
          {turns.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              compact
              title={t('sessionOverview.noTurnsTitle')}
              subtitle={t('sessionOverview.noTurnsSub')}
            />
          ) : (
            turns.map((turn) => {
              const tools = toolCallCount(turn);
              const topBadge = [...turn.badges].sort(
                (a, b) =>
                  (({ danger: 0, warn: 1, info: 2 })[b.level] ?? 9) -
                  ({ danger: 0, warn: 1, info: 2 }[a.level] ?? 9),
              )[0];
              return (
                <ClickRow
                  key={turn.id}
                  className={styles.turnRow}
                  onClick={() =>
                    navigate(
                      `${hrefFor({
                        kind: 'session',
                        workspace,
                        session,
                        tab: 'review',
                      })}#turn-${turn.id}`,
                    )
                  }
                >
                  <span className={styles.turnIdx}>#{turn.idx}</span>
                  <div className={styles.turnBody}>
                    <span className={styles.turnPrompt}>
                      {turn.user_prompt || t('sessionOverview.noPrompt')}
                    </span>
                    <div className={styles.turnDots}>
                      {tools.map((tc, i) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: tool_call order is stable within a turn
                          key={i}
                          className={`${styles.dot} ${dotClassFor(tc.tool)}`}
                          title={tc.tool ?? t('replay.toolCall')}
                        />
                      ))}
                      {tools.length === 0 && <span>{t('sessionOverview.noToolCalls')}</span>}
                      <span style={{ marginLeft: 8 }}>
                        {t('common.edits', { n: turn.edits.length })}
                      </span>
                      {topBadge && (
                        <span
                          className={`${styles.badgeChip} ${topBadge.level === 'danger' ? styles.badgeChipDanger : styles.badgeChipWarn}`}
                          title={topBadge.detail}
                        >
                          {topBadge.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={styles.turnMeta}>
                    {fmtClock(turn.started_at)}
                    {turn.ended_at != null && (
                      <span>· {fmtDuration(turn.ended_at - turn.started_at)}</span>
                    )}
                  </span>
                </ClickRow>
              );
            })
          )}
        </div>
      </Card>
      {showDelete && (
        <ConfirmDeleteModal
          sessionId={session}
          agent={agent}
          startedAt={started}
          onClose={() => setShowDelete(false)}
          onDeleted={() => navigate(hrefFor({ kind: 'workspace', workspace }))}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
