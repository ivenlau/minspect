import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  compact?: boolean;
}

// Unified "no data here" block. All pages use this instead of ad-hoc
// "<p>no x yet</p>" so the tone and iconography stay consistent.
export function EmptyState({ icon: Icon = Inbox, title, subtitle, compact }: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ''}`}>
      <Icon size={compact ? 20 : 28} className={styles.icon} />
      <div className={styles.title}>{title}</div>
      {subtitle && <div className={styles.sub}>{subtitle}</div>}
    </div>
  );
}
