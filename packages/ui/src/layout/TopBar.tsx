import type { ReactNode } from 'react';
import { LangToggle } from '../components/LangToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { useLang } from '../i18n';
import styles from './TopBar.module.css';

export interface Crumb {
  label: string;
  href?: string; // if absent → current
  mono?: boolean;
}

export interface TopBarProps {
  crumbs?: Crumb[];
  tabs?: ReactNode;
  rightSlot?: ReactNode;
  // Connection status for the indicator dot next to the port pill.
  connected?: boolean;
  port?: number | null;
}

export function TopBar({ crumbs = [], tabs, rightSlot, connected = true, port }: TopBarProps) {
  const { t } = useLang();
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <a href="#/">
          <span className={styles.brandDot} />
          <span>{t('topbar.brand')}</span>
        </a>
      </div>

      {crumbs.length > 0 && (
        <nav className={styles.crumb} aria-label="breadcrumb">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span
                key={`${c.label}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span className={styles.crumbSep}>/</span>
                {c.href && !isLast ? (
                  <a href={c.href} className={c.mono ? 'mono' : undefined}>
                    {c.label}
                  </a>
                ) : (
                  <span className={`${styles.crumbCurrent}${c.mono ? ' mono' : ''}`}>
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {tabs}

      <div className={styles.spacer} />

      {rightSlot}

      <LangToggle />
      <ThemeToggle />

      {port != null && (
        <div
          className={styles.portPill}
          title={connected ? t('topbar.connected') : t('topbar.disconnected')}
        >
          <span className={`${styles.portDot} ${!connected ? styles.portDotDown : ''}`} />
          <span>127.0.0.1:{port}</span>
        </div>
      )}
    </header>
  );
}
