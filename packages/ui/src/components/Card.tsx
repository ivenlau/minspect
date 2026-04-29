import type { ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  title?: ReactNode;
  right?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, right, meta, children, className }: CardProps) {
  const hasHeader = title != null || right != null;
  if (!hasHeader) {
    return <section className={`${styles.card} ${className ?? ''}`}>{children}</section>;
  }
  return (
    <section className={`${styles.card} ${styles.pad0} ${className ?? ''}`}>
      <header className={styles.hdr}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
        <span className={styles.spacer} />
        {right}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
