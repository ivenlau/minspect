import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}

// Single gray pulse block. Compose several into column shapes as needed —
// heavier abstraction isn't earning its weight for this code base.
export function Skeleton({ width, height = 14, radius, style }: SkeletonProps) {
  return (
    <span
      className={styles.sk}
      style={{
        width: width ?? '100%',
        height,
        borderRadius: radius ?? 4,
        ...style,
      }}
    />
  );
}

// Small pulsing green dot signalling a session whose `ended_at` is still
// null (Claude Code hasn't sent SessionEnd yet). Used in the workspaces
// sidebar and the timeline page.
export function LiveDot({ title }: { title?: string }) {
  return <span className={styles.live} title={title ?? 'session in progress'} />;
}
