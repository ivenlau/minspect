import type { ReactNode } from 'react';
import styles from './ThreePane.module.css';

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
// column (Dashboard default, Review).
export function ThreePane({ sidebar, inspector, children }: ThreePaneProps) {
  return (
    <div className={styles.root}>
      <aside className={styles.side}>{sidebar}</aside>
      <main className={styles.main}>{children}</main>
      {inspector && <aside className={styles.inspector}>{inspector}</aside>}
    </div>
  );
}
