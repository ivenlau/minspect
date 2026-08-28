import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Resizer.module.css';

export interface ResizerProps {
  // Which edge the resizer sits on. `left`: dragging right widens the pane
  // to its left (sidebar). `right`: dragging right NARROWS the pane to its
  // left (inspector) — the divider sits between main and the right pane.
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset?: () => void;
  label: string;
}

// Vertical drag handle between panes. Pointer events (not mouse events) so
// it also works with pen/touch; setPointerCapture keeps tracking outside the
// 4px hit area. Double-click resets to the default width via onReset.
export function Resizer({ side, width, min, max, onResize, onReset, label }: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ pointer: 0, width: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { pointer: e.clientX, width };
      setDragging(true);
      // Text under the pointer would otherwise get selected while dragging.
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const delta = e.clientX - startRef.current.pointer;
      const next =
        side === 'left' ? startRef.current.width + delta : startRef.current.width - delta;
      onResize(Math.min(max, Math.max(min, next)));
    },
    [dragging, min, max, onResize, side],
  );

  const endDrag = useCallback(() => {
    setDragging(false);
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    // Safety net: if the pointer is released outside our element and capture
    // was lost (e.g. element unmounted), still clear the dragging state.
    if (dragging) {
      window.addEventListener('pointerup', endDrag);
      return () => window.removeEventListener('pointerup', endDrag);
    }
  }, [dragging, endDrag]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      className={`${styles.resizer} ${dragging ? styles.dragging : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onReset?.()}
      title={label}
    />
  );
}
