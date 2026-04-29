import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import styles from './ClickRow.module.css';

export interface ClickRowProps {
  onClick: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  selected?: boolean;
  children: ReactNode;
}

// Renders a semantic <button> styled as a row. Keeps the visual density of
// a custom div but gives us real keyboard handling (Enter / Space, focus
// ring, tab order) for free.
export function ClickRow({ onClick, className, style, title, selected, children }: ClickRowProps) {
  return (
    <button
      type="button"
      className={`${styles.row} ${className ?? ''}`}
      style={style}
      title={title}
      aria-pressed={selected ? true : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
