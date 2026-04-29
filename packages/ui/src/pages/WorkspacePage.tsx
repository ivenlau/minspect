import { Clock, FileText } from 'lucide-react';
import { usePoll } from '../api';
import { Card } from '../components/Card';
import { ClickRow } from '../components/ClickRow';
import { EmptyState } from '../components/EmptyState';
import { LiveDot } from '../components/Skeleton';
import { useLang } from '../i18n';
import { Inspector } from '../layout/Inspector';
import { hrefFor, navigate } from '../router';
import styles from './WorkspacePage.module.css';

export interface WorkspaceDetail {
  path: string;
  created_at: number;
  session_count: number;
  turn_count: number;
  edit_count: number;
  files_touched: number;
  last_activity: number | null;
  agents: string[];
  sessions: Array<{
    id: string;
    agent: string;
    agent_version: string | null;
    started_at: number;
    ended_at: number | null;
    turn_count: number;
    file_count: number;
  }>;
  files: Array<{ file_path: string; edit_count: number; last_edited: number }>;
}

function pathTail(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export interface WorkspacePageProps {
  workspace: string;
}

export function WorkspacePage({ workspace }: WorkspacePageProps) {
  const { t } = useLang();
  const url = `/api/workspaces/${encodeURIComponent(workspace)}`;
  const { data, error } = usePoll<WorkspaceDetail>(url, 5000);

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{pathTail(workspace)}</h1>
        <p style={{ color: 'var(--danger)' }}>
          {t('status.failedToLoadInline', { msg: error.message })}
        </p>
      </div>
    );
  }

  const d = data;
  const topFileEdits = d?.files[0]?.edit_count ?? 1;

  return (
    <div className={styles.page}>
      <div className={styles.hdr}>
        <h1 className={styles.title}>{pathTail(workspace)}</h1>
        <span className={styles.pathText}>{workspace}</span>
      </div>

      <div className={styles.statRow}>
        <Stat label={t('workspace.stat.sessions')} value={d?.session_count ?? 0} />
        <Stat label={t('workspace.stat.turns')} value={d?.turn_count ?? 0} />
        <Stat label={t('workspace.stat.edits')} value={d?.edit_count ?? 0} />
        <Stat label={t('workspace.stat.filesTouched')} value={d?.files_touched ?? 0} />
      </div>

      <div className={styles.splitRow}>
        <Card title={t('workspace.sessionsCardTitle')} meta={String(d?.sessions.length ?? 0)}>
          <div className={styles.sessTbl}>
            <div className={styles.sessHdr}>
              <span>{t('workspace.sessionsTbl.id')}</span>
              <span>{t('workspace.sessionsTbl.agent')}</span>
              <span>{t('workspace.sessionsTbl.started')}</span>
              <span>{t('workspace.sessionsTbl.turns')}</span>
              <span>{t('workspace.sessionsTbl.files')}</span>
              <span>⚠</span>
            </div>
            <div className={styles.sessBody}>
              {(d?.sessions ?? []).map((s) => (
                <ClickRow
                  key={s.id}
                  className={styles.sessRow}
                  onClick={() =>
                    navigate(
                      hrefFor({
                        kind: 'session',
                        workspace,
                        session: s.id,
                        tab: 'overview',
                      }),
                    )
                  }
                >
                  <span className={styles.sessRowId}>
                    {s.id.slice(0, 8)}
                    {s.ended_at == null && (
                      <>
                        {' '}
                        <LiveDot />
                      </>
                    )}
                  </span>
                  <span className={styles.sessRowAgent}>{s.agent}</span>
                  <span className={styles.sessRowStarted}>{fmtTime(s.started_at)}</span>
                  <span className={styles.sessRowCol}>{s.turn_count}</span>
                  <span className={styles.sessRowCol}>{s.file_count}</span>
                  <span className={styles.sessRowMuted}>—</span>
                </ClickRow>
              ))}
              {(d?.sessions.length ?? 0) === 0 && (
                <EmptyState icon={Clock} compact title={t('workspace.noSessions')} />
              )}
            </div>
          </div>
        </Card>

        <Card title={t('workspace.filesCardTitle')} meta={String(d?.files.length ?? 0)}>
          <div className={styles.filesList}>
            {(d?.files ?? []).map((f) => (
              <ClickRow
                key={f.file_path}
                className={styles.fileRow}
                onClick={() => navigate(hrefFor({ kind: 'blame', workspace, file: f.file_path }))}
                title={f.file_path}
              >
                <span className={styles.filePath}>{f.file_path}</span>
                <div className={styles.fileBar}>
                  <div
                    className={styles.fileBarFill}
                    style={{ width: `${(f.edit_count / topFileEdits) * 100}%` }}
                  />
                </div>
                <span className={styles.fileCount}>{f.edit_count} edits</span>
              </ClickRow>
            ))}
            {(d?.files.length ?? 0) === 0 && (
              <EmptyState icon={FileText} compact title={t('workspace.noFiles')} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

// Inspector rendered next to the Workspace page. Aligned with the Pencil
// mockup: summary stats, top files (with heat-strip-style bars), recent
// sessions, and quick actions (open blame for top file, open Review/Replay
// for the latest session).
export function WorkspaceInspector({ workspace }: WorkspacePageProps) {
  const { t } = useLang();
  const url = `/api/workspaces/${encodeURIComponent(workspace)}`;
  const { data } = usePoll<WorkspaceDetail>(url, 10_000);

  const topFiles = (data?.files ?? []).slice(0, 5);
  const topFileEdits = topFiles[0]?.edit_count ?? 1;
  const recentSessions = (data?.sessions ?? []).slice(0, 3);
  const firstFile = topFiles[0]?.file_path;
  const latestSession = recentSessions[0]?.id;

  return (
    <Inspector
      title={t('workspace.inspector.title')}
      body={
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <InspectorSection label={t('workspace.inspector.path')} mono>
            <span style={{ wordBreak: 'break-all' }}>{workspace}</span>
          </InspectorSection>

          <InspectorSection label={t('workspace.inspector.summary')}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
              <span>
                <span style={{ color: 'var(--text-0)' }}>{data?.session_count ?? 0}</span>
                <span style={{ color: 'var(--text-2)' }}> {t('workspace.inspector.sessions')}</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-0)' }}>{data?.edit_count ?? 0}</span>
                <span style={{ color: 'var(--text-2)' }}> {t('workspace.inspector.editsLbl')}</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-0)' }}>{data?.files_touched ?? 0}</span>
                <span style={{ color: 'var(--text-2)' }}> {t('workspace.inspector.filesLbl')}</span>
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {t('workspace.inspector.agentsLabel')} {(data?.agents ?? []).join(', ') || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {t('workspace.inspector.lastActivity')}{' '}
              {data?.last_activity ? fmtTime(data.last_activity) : '—'}
            </div>
          </InspectorSection>

          {topFiles.length > 0 && (
            <InspectorSection label={t('workspace.inspector.topFiles', { n: topFiles.length })}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topFiles.map((f) => {
                  const pct = Math.round((f.edit_count / topFileEdits) * 100);
                  return (
                    <ClickRow
                      key={f.file_path}
                      className={styles.fileRow}
                      onClick={() =>
                        navigate(hrefFor({ kind: 'blame', workspace, file: f.file_path }))
                      }
                      title={f.file_path}
                    >
                      <span className={styles.filePath}>{f.file_path}</span>
                      <div className={styles.fileBar}>
                        <div className={styles.fileBarFill} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={styles.fileCount}>{f.edit_count}</span>
                    </ClickRow>
                  );
                })}
              </div>
            </InspectorSection>
          )}

          {recentSessions.length > 0 && (
            <InspectorSection
              label={t('workspace.inspector.recentSessions', { n: recentSessions.length })}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentSessions.map((s) => (
                  <ClickRow
                    key={s.id}
                    className={styles.fileRow}
                    onClick={() =>
                      navigate(
                        hrefFor({
                          kind: 'session',
                          workspace,
                          session: s.id,
                          tab: 'overview',
                        }),
                      )
                    }
                    title={`${s.agent}  ·  ${fmtTime(s.started_at)}`}
                  >
                    <span
                      className={styles.filePath}
                      style={{ direction: 'ltr', textAlign: 'left' }}
                    >
                      {s.id.slice(0, 8)} {s.agent}
                    </span>
                    <span className={styles.fileCount}>
                      {s.turn_count}t · {s.file_count}f
                    </span>
                  </ClickRow>
                ))}
              </div>
            </InspectorSection>
          )}

          <InspectorSection label={t('workspace.inspector.actions')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <ActionBtn
                disabled={!firstFile}
                onClick={() => {
                  if (firstFile) navigate(hrefFor({ kind: 'blame', workspace, file: firstFile }));
                }}
              >
                {t('workspace.inspector.openBlame')}
              </ActionBtn>
              <ActionBtn
                disabled={!latestSession}
                onClick={() => {
                  if (latestSession)
                    navigate(
                      hrefFor({
                        kind: 'session',
                        workspace,
                        session: latestSession,
                        tab: 'review',
                      }),
                    );
                }}
              >
                {t('workspace.inspector.reviewLatest')}
              </ActionBtn>
              <ActionBtn
                disabled={!latestSession}
                onClick={() => {
                  if (latestSession)
                    navigate(
                      hrefFor({
                        kind: 'session',
                        workspace,
                        session: latestSession,
                        tab: 'replay',
                      }),
                    );
                }}
              >
                {t('workspace.inspector.replayLatest')}
              </ActionBtn>
            </div>
          </InspectorSection>
        </div>
      }
    />
  );
}

function InspectorSection({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-2)',
          fontWeight: 600,
          letterSpacing: 0.8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-0)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        all: 'unset',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '6px 10px',
        borderRadius: 'var(--radius-3)',
        border: '1px solid var(--border)',
        background: 'transparent',
        fontSize: 11,
        color: disabled ? 'var(--text-2)' : 'var(--text-0)',
        opacity: disabled ? 0.6 : 1,
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  );
}
