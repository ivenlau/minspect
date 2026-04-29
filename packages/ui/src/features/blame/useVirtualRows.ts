import { type RefObject, useEffect, useState } from 'react';

// Visible index window for a fixed-row-height virtualized list. `endIndex`
// is exclusive. The caller is responsible for pinning the row heights to
// `rowHeight` — if real rendered rows diverge, the scrollbar height and
// visible slice drift apart.
export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
}

export interface VirtualRowsArgs {
  scrollRef: RefObject<HTMLElement | null>;
  totalRows: number;
  rowHeight: number;
  buffer?: number;
}

export interface VisibleArgs {
  scrollTop: number;
  clientHeight: number;
  totalRows: number;
  rowHeight: number;
  buffer: number;
}

// Pure function separated out so it can be unit-tested without touching the
// DOM. Everything the hook reads from the scroll element feeds into this.
export function computeVisible({
  scrollTop,
  clientHeight,
  totalRows,
  rowHeight,
  buffer,
}: VisibleArgs): VirtualWindow {
  if (totalRows <= 0 || rowHeight <= 0 || clientHeight <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }
  const rawStart = Math.floor(scrollTop / rowHeight);
  const rawEnd = Math.ceil((scrollTop + clientHeight) / rowHeight);
  const startIndex = Math.max(0, rawStart - buffer);
  const endIndex = Math.min(totalRows, rawEnd + buffer);
  return { startIndex, endIndex };
}

// Subscribe a scroll container + window resizes and report the slice to
// render. Uses `ResizeObserver` so container resize (three-pane split)
// triggers re-computation too.
export function useVirtualRows({
  scrollRef,
  totalRows,
  rowHeight,
  buffer = 10,
}: VirtualRowsArgs): VirtualWindow {
  const [win, setWin] = useState<VirtualWindow>({
    startIndex: 0,
    endIndex: Math.min(totalRows, 50),
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      setWin({ startIndex: 0, endIndex: 0 });
      return;
    }
    const compute = () => {
      const next = computeVisible({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        totalRows,
        rowHeight,
        buffer,
      });
      setWin((prev) =>
        prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next,
      );
    };
    compute();
    el.addEventListener('scroll', compute, { passive: true });
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', compute);
      ro.disconnect();
    };
  }, [scrollRef, totalRows, rowHeight, buffer]);

  return win;
}
