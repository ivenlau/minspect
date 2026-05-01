import {
  AlertCircle,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type RefreshResult,
  type SessionRow,
  type WorkspaceRow,
  postJson,
  usePoll,
} from '../../api';
import { ClickRow } from '../../components/ClickRow';
import { EmptyState } from '../../components/EmptyState';
import { LiveDot } from '../../components/Skeleton';
import { useLang } from '../../i18n';
import { hrefFor, navigate } from '../../router';
import styles from './WorkspacesSidebar.module.css';

export interface WorkspacesSidebarProps {
  activeWorkspace?: string | null;
  activeSession?: string | null;
}

interface ListResp {
  workspaces: WorkspaceRow[];
}

interface SessionsResp {
  sessions: SessionRow[];
}

// Header refresh button. One click triggers the collector's /api/refresh —
// which runs `install claude-code`, `install opencode`, and `import-codex
// --all --since 30d` server-side. Shows a spinning icon while in-flight,
// then a brief ✓ / ✗ badge. Double-click is disabled by our own `busy`
// guard; the server also serializes via an in-process mutex (409 if racing).
function RefreshButton() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<'ok' | 'error' | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    setLastError(null);
    try {
      const r = await postJson<RefreshResult>('/api/refresh');
      setLastResult(r.ok ? 'ok' : 'error');
      if (!r.ok) {
        const failures = r.steps
          .filter((s) => s.status === 'error')
          .map((s) => `${s.name}: ${s.error ?? 'failed'}`)
          .join('\n');
        setLastError(failures || 'one or more steps failed');
      }
    } catch (e) {
      setLastResult('error');
      setLastError((e as Error).message);
    } finally {
      setBusy(false);
      // Auto-clear the ✓ badge after 2s; leave ✗ until next click so users
      // don't miss the failure.
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setLastResult((prev) => (prev === 'ok' ? null : prev));
      }, 2000);
    }
  };

  const title = busy
    ? t('sidebar.refreshBusy')
    : lastError
      ? t('sidebar.refreshFailed', { err: lastError })
      : t('sidebar.refreshIdle');

  return (
    <button
      type="button"
      className={`${styles.refreshBtn} ${busy ? styles.refreshBtnBusy : ''} ${lastResult === 'error' ? styles.refreshBtnError : ''}`}
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={t('sidebar.refreshIdle')}
    >
      {lastResult === 'ok' && !busy ? (
        <Check size={12} />
      ) : lastResult === 'error' && !busy ? (
        <AlertCircle size={12} />
      ) : (
        <RefreshCw size={12} className={busy ? styles.spin : undefined} />
      )}
    </button>
  );
}

function pathTail(p: string): string {
  // Keep just the last path segment for display; full path lives in tooltip.
  const slashes = p.split(/[\\/]/).filter(Boolean);
  return slashes[slashes.length - 1] ?? p;
}

function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function agentShort(agent: string | null | undefined): string {
  if (!agent) return '?';
  if (agent === 'claude-code') return 'claude';
  if (agent === 'opencode') return 'open';
  return agent;
}

export function WorkspacesSidebar({ activeWorkspace, activeSession }: WorkspacesSidebarProps) {
  const { t } = useLang();
  const { data } = usePoll<ListResp>('/api/workspaces', 5000);
  const workspaces = data?.workspaces ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t('sidebar.workspacesHeading')}</span>
        <span className={styles.spacer} />
        <RefreshButton />
      </div>
      {workspaces.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          compact
          title={t('sidebar.workspacesEmptyTitle')}
          subtitle={t('sidebar.workspacesEmptySub')}
        />
      ) : (
        workspaces.map((w) => (
          <WorkspaceBranch
            key={w.path}
            ws={w}
            expanded={activeWorkspace === w.path}
            activeSession={activeSession}
          />
        ))
      )}
    </div>
  );
}

interface BranchProps {
  ws: WorkspaceRow;
  expanded: boolean;
  activeSession?: string | null;
}

function WorkspaceBranch({ ws, expanded, activeSession }: BranchProps) {
  // `open` is the user's controlled expand state. `expanded` (the route
  // points at this workspace) auto-opens via the effect below, but the user
  // can still collapse by clicking — the previous `open || isActive` logic
  // held the branch forever-open once the route was active.
  const [open, setOpen] = useState(expanded);
  useEffect(() => {
    if (expanded) setOpen(true);
  }, [expanded]);

  return (
    <>
      <ClickRow
        className={`${styles.wsRow} ${expanded ? styles.wsRowActive : ''}`}
        onClick={() => {
          setOpen((v) => !v);
          navigate(hrefFor({ kind: 'workspace', workspace: ws.path }));
        }}
        title={ws.path}
      >
        <ChevronRight className={`${styles.chev} ${open ? styles.chevOpen : ''}`} />
        {open ? (
          <FolderOpen className={`${styles.folder} ${expanded ? styles.folderActive : ''}`} />
        ) : (
          <Folder className={styles.folder} />
        )}
        <span className={`${styles.name} ${expanded ? styles.nameActive : ''}`}>
          {pathTail(ws.path)}
        </span>
        <span className={styles.count}>{ws.total_edits}</span>
      </ClickRow>
      {open && <SessionList workspace={ws.path} activeSession={activeSession} />}
    </>
  );
}

function SessionList({
  workspace,
  activeSession,
}: {
  workspace: string;
  activeSession?: string | null;
}) {
  const { t } = useLang();
  const url = `/api/workspaces/${encodeURIComponent(workspace)}/sessions`;
  const { data } = usePoll<SessionsResp>(url, 5000);
  const sessions = data?.sessions ?? [];
  if (sessions.length === 0) {
    return null;
  }
  return (
    <>
      {sessions.map((s) => {
        const active = activeSession === s.id;
        const isLive = s.ended_at == null;
        return (
          <ClickRow
            key={s.id}
            className={`${styles.sessRow} ${active ? styles.sessRowActive : ''}`}
            onClick={() =>
              navigate(hrefFor({ kind: 'session', workspace, session: s.id, tab: 'overview' }))
            }
            title={`${s.agent}  ·  ${new Date(s.started_at).toLocaleString()}`}
          >
            {isLive ? (
              <LiveDot title={t('sidebar.liveSession')} />
            ) : (
              <span className={styles.dot} />
            )}
            <span className={styles.sessId}>{s.id.slice(0, 8)}</span>
            <span className={styles.agentTag}>{agentShort(s.agent)}</span>
            <span className={styles.sessTime}>{timeOfDay(s.started_at)}</span>
          </ClickRow>
        );
      })}
    </>
  );
}
