import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeLevel = 'info' | 'warn' | 'danger' | 'success' | 'muted';

export interface BadgeProps {
  level?: BadgeLevel;
  children: ReactNode;
  title?: string;
}

export function Badge({ level = 'info', children, title }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[level]}`} title={title}>
      {children}
    </span>
  );
}
