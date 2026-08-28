import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Resizer } from '../components/Resizer';
import {
  INSPECTOR_PANE,
  SIDEBAR_PANE,
  clearPaneWidth,
  readPaneWidth,
  writePaneWidth,
} from '../components/paneWidths';
import { useLang } from '../i18n';
import styles from './ThreePane.module.css';
import { SidebarWidthContext } from './sidebarWidth';

export interface ShellProps {
  topBar: ReactNode;
  statusBar: ReactNode;
  children: ReactNode;
}

// Overall page shell: topBar → content → statusBar, stacked vertically.
export function Shell({ topBar, statusBar, children }: ShellProps) {
  return (
    <div className={styles.shellRoot}>
      {topBar}
      {children}
      {statusBar}
    </div>
  );
}

export interface ThreePaneProps {
  sidebar: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}

// The 3-pane body used across Dashboard / Workspace / Blame / Review / Replay.
// The inspector is optional; omit it on dense screens that don't need a detail
// column (Dashboard default, Review). Both fixed-width panes are resizable
// via the Resizer handles; widths persist to localStorage (double-click a
// handle to reset to default).
export function ThreePane({ sidebar, inspector, children }: ThreePaneProps) {
  const { t } = useLang();
  const [sideW, setSideW] = useState(() => readPaneWidth(SIDEBAR_PANE));
  const [inspW, setInspW] = useState(() => readPaneWidth(INSPECTOR_PANE));

  const onSideResize = useCallback((w: number) => {
    setSideW(w);
    writePaneWidth(SIDEBAR_PANE, w);
  }, []);
  const onInspResize = useCallback((w: number) => {
    setInspW(w);
    writePaneWidth(INSPECTOR_PANE, w);
  }, []);
  const onSideReset = useCallback(() => {
    setSideW(SIDEBAR_PANE.def);
    clearPaneWidth(SIDEBAR_PANE);
  }, []);
  const onInspReset = useCallback(() => {
    setInspW(INSPECTOR_PANE.def);
    clearPaneWidth(INSPECTOR_PANE);
  }, []);

  return (
    <div className={styles.root}>
      <SidebarWidthContext.Provider value={sideW}>
        <aside className={styles.side} style={{ width: sideW }}>
          {sidebar}
        </aside>
      </SidebarWidthContext.Provider>
      <Resizer
        side="left"
        width={sideW}
        min={SIDEBAR_PANE.min}
        max={SIDEBAR_PANE.max}
        onResize={onSideResize}
        onReset={onSideReset}
        label={t('layout.resizeSidebar')}
      />
      <main className={styles.main}>{children}</main>
      {inspector && (
        <>
          <Resizer
            side="right"
            width={inspW}
            min={INSPECTOR_PANE.min}
            max={INSPECTOR_PANE.max}
            onResize={onInspResize}
            onReset={onInspReset}
            label={t('layout.resizeInspector')}
          />
          <aside className={styles.inspector} style={{ width: inspW }}>
            {inspector}
          </aside>
        </>
      )}
    </div>
  );
}
