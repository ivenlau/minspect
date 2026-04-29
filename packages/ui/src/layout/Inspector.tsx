import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Inspector.module.css';

export interface InspectorProps {
  title: ReactNode;
  icon?: ReactNode;
  body: ReactNode;
  onClose?: () => void;
}

export function Inspector({ title, icon, body, onClose }: InspectorProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {icon}
        <span>{title}</span>
        <span className={styles.spacer} />
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="close inspector"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className={styles.body}>{body}</div>
    </div>
  );
}
