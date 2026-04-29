import { Compass, Link2Off } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type HealthStatus, usePoll } from './api';
import { EmptyState } from './components/EmptyState';
import { Tabs } from './components/Tabs';
import { FileTreeSidebar } from './features/blame/FileTreeSidebar';
import { CommandPalette } from './features/search/CommandPalette';
import { WorkspacesSidebar } from './features/workspaces/WorkspacesSidebar';
import { type StringKey, useLang } from './i18n';
import { StatusBar } from './layout/StatusBar';
import { Shell, ThreePane } from './layout/ThreePane';
import { type Crumb, TopBar } from './layout/TopBar';
import { BlamePage } from './pages/BlamePage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionPage } from './pages/SessionPage';
import { TimelinePage } from './pages/TimelinePage';
import { WorkspaceInspector, WorkspacePage } from './pages/WorkspacePage';
import { type Route, hrefFor, useRoute } from './router';
import { useHashAnchor } from './router/useHashAnchor';

// Root component. Owns the Shell (topbar + body + statusbar) and delegates
// body rendering to a tiny route switch. Each branch supplies its own
// breadcrumbs so TopBar doesn't need route-awareness.
export function App() {
  const route = useRoute();
  const { t } = useLang();
  const { data: health } = usePoll<HealthStatus>('/health', 10_000);
  const connected = health?.status === 'ok';
  useHashAnchor();

  // Global Cmd/Ctrl+K opens the command palette. Kept here at the App root
  // so it works from every page without each page wiring its own listener.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Shell
      topBar={<TopBar {...topBarPropsFor(route, t)} connected={connected} />}
      statusBar={<StatusBar leftSlot={<StatusBarLeft route={route} />} />}
    >
      <ThreePane sidebar={sidebarFor(route)} inspector={inspectorFor(route)}>
        <RouteBody route={route} />
      </ThreePane>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Shell>
  );
}

// Blame gets a file tree scoped to its workspace; everything else shares the
// top-level workspaces tree.
function sidebarFor(route: Route): React.ReactNode {
  if (route.kind === 'blame') {
    return <FileTreeSidebar workspace={route.workspace} activeFile={route.file} />;
  }
  return <WorkspacesSidebar {...sidebarPropsFor(route)} />;
}

function inspectorFor(route: Route): React.ReactNode | undefined {
  if (route.kind === 'workspace') return <WorkspaceInspector workspace={route.workspace} />;
  // Blame page renders its own inspector inline so it can share selected-line state.
  return undefined;
}

function StatusBarLeft({ route }: { route: Route }) {
  const { t } = useLang();
  switch (route.kind) {
    case 'dashboard':
      return <span>{t('crumbs.dashboard')}</span>;
    case 'timeline':
      return <span>{t('crumbs.timeline')}</span>;
    case 'workspace':
      return <span>{t('status.left.workspace', { path: route.workspace })}</span>;
    case 'session': {
      const tabLabel = t(`tabs.${route.tab}` as StringKey);
      return (
        <span>
          {t('status.left.sessionPrefix')} <span className="mono">{route.session.slice(0, 8)}</span>{' '}
          · {tabLabel}
        </span>
      );
    }
    case 'blame':
      return (
        <span>
          {t('status.left.blamePrefix')} · <span className="mono">{route.file}</span>
        </span>
      );
    default:
      return <span>{t('topbar.brand')}</span>;
  }
}

type TFn = (key: StringKey, vars?: Record<string, unknown>) => string;

function topBarPropsFor(
  route: Route,
  t: TFn,
): { crumbs: Crumb[]; tabs?: React.ReactNode; port: number } {
  // Port here is a UI concern only — the real port is whatever the collector
  // is listening on. We don't have it client-side without an endpoint, so we
  // read location.port.
  const port = Number.parseInt(window.location.port || '0', 10) || 0;
  switch (route.kind) {
    case 'dashboard':
      return { crumbs: [{ label: t('crumbs.dashboard') }], port };
    case 'timeline':
      return { crumbs: [{ label: t('crumbs.timeline') }], port };
    case 'workspace':
      return {
        crumbs: [
          { label: t('crumbs.workspaces'), href: '#/' },
          { label: route.workspace, mono: true },
        ],
        port,
      };
    case 'session': {
      const sessionTabs = (
        <Tabs
          active={route.tab}
          items={[
            {
              key: 'overview',
              label: t('tabs.overview'),
              href: hrefFor({ ...route, tab: 'overview' }),
            },
            { key: 'review', label: t('tabs.review'), href: hrefFor({ ...route, tab: 'review' }) },
            { key: 'replay', label: t('tabs.replay'), href: hrefFor({ ...route, tab: 'replay' }) },
            { key: 'files', label: t('tabs.files'), href: hrefFor({ ...route, tab: 'files' }) },
          ]}
        />
      );
      return {
        crumbs: [
          { label: t('crumbs.workspaces'), href: '#/' },
          {
            label: route.workspace,
            mono: true,
            href: hrefFor({ kind: 'workspace', workspace: route.workspace }),
          },
          {
            label: t('crumbs.session', { id: route.session.slice(0, 8) }),
            mono: true,
          },
        ],
        tabs: sessionTabs,
        port,
      };
    }
    case 'blame':
      return {
        crumbs: [
          { label: t('crumbs.workspaces'), href: '#/' },
          {
            label: route.workspace,
            mono: true,
            href: hrefFor({ kind: 'workspace', workspace: route.workspace }),
          },
          { label: route.file, mono: true },
        ],
        port,
      };
    default:
      return { crumbs: [], port };
  }
}

function sidebarPropsFor(route: Route) {
  if (route.kind === 'workspace') return { activeWorkspace: route.workspace, activeSession: null };
  if (route.kind === 'session')
    return { activeWorkspace: route.workspace, activeSession: route.session };
  if (route.kind === 'blame') return { activeWorkspace: route.workspace, activeSession: null };
  return { activeWorkspace: null, activeSession: null };
}

function RouteBody({ route }: { route: Route }) {
  const { t } = useLang();
  switch (route.kind) {
    case 'dashboard':
      return <DashboardPage />;
    case 'timeline':
      return <TimelinePage />;
    case 'workspace':
      return <WorkspacePage workspace={route.workspace} />;
    case 'session':
      return <SessionPage workspace={route.workspace} session={route.session} tab={route.tab} />;
    case 'blame':
      return <BlamePage workspace={route.workspace} file={route.file} />;
    case 'legacy-timeline':
      return (
        <EmptyState
          icon={Link2Off}
          title={t('app.legacyTitle')}
          subtitle={
            <>
              {t('app.legacyBody.pre')} <code>{route.hash}</code>. {t('app.legacyBody.open')}{' '}
              <a href="#/">{t('app.legacyBody.theDashboard')}</a> {t('app.legacyBody.instead')}
            </>
          }
        />
      );
    default:
      return (
        <EmptyState
          icon={Compass}
          title={t('app.notFoundTitle')}
          subtitle={
            <>
              {t('app.notFoundBody.pre')}
              {route.kind === 'not-found' && route.raw ? (
                <>
                  {' '}
                  (<code>{route.raw}</code>)
                </>
              ) : null}
              {t('app.notFoundBody.tryDash')} <a href="#/">{t('app.notFoundBody.dashboard')}</a>
              {t('app.notFoundBody.period')}
            </>
          }
        />
      );
  }
}
