// Pane-width persistence shared by the ThreePane layout and the page-level
// panes (Blame/Replay inspectors, Review turn nav). Kept as plain functions
// (not a hook) so they're trivially unit-testable.

import { useCallback, useState } from 'react';

export interface PaneConfig {
  storageKey: string;
  min: number;
  max: number;
  def: number;
}

export const SIDEBAR_PANE: PaneConfig = {
  storageKey: 'minspect.pane.sidebar',
  min: 180,
  max: 480,
  def: 240,
};

export const INSPECTOR_PANE: PaneConfig = {
  storageKey: 'minspect.pane.inspector',
  min: 240,
  max: 640,
  def: 320,
};

// Page-internal panes (rendered inside ThreePane's main, so they can't reuse
// the shell's Resizer slots).
export const BLAME_INSPECTOR_PANE: PaneConfig = {
  storageKey: 'minspect.pane.blameInspector',
  min: 240,
  max: 640,
  def: 340,
};

export const REPLAY_INSPECTOR_PANE: PaneConfig = {
  storageKey: 'minspect.pane.replayInspector',
  min: 240,
  max: 640,
  def: 320,
};

export const REVIEW_TURNNAV_PANE: PaneConfig = {
  storageKey: 'minspect.pane.reviewTurnNav',
  min: 160,
  max: 420,
  def: 240,
};

export function clampWidth(cfg: PaneConfig, w: number): number {
  return Math.min(cfg.max, Math.max(cfg.min, w));
}

// Read a persisted width, clamping whatever comes back — localStorage may
// hold a stale/unvalidated value, and try/catch guards blocked storage.
export function readPaneWidth(cfg: PaneConfig): number {
  if (typeof window === 'undefined') return cfg.def;
  try {
    const raw = window.localStorage.getItem(cfg.storageKey);
    if (raw == null) return cfg.def;
    const n = Number(raw);
    return Number.isFinite(n) ? clampWidth(cfg, n) : cfg.def;
  } catch {
    return cfg.def;
  }
}

export function writePaneWidth(cfg: PaneConfig, w: number): void {
  try {
    window.localStorage.setItem(cfg.storageKey, String(Math.round(w)));
  } catch {
    /* blocked storage — this session only */
  }
}

export function clearPaneWidth(cfg: PaneConfig): void {
  try {
    window.localStorage.removeItem(cfg.storageKey);
  } catch {
    /* blocked */
  }
}

// State + persistence for one resizable pane. Feed straight into <Resizer>.
export function useResizablePane(cfg: PaneConfig): {
  width: number;
  onResize: (w: number) => void;
  onReset: () => void;
} {
  const [width, setWidth] = useState(() => readPaneWidth(cfg));
  const onResize = useCallback(
    (w: number) => {
      setWidth(w);
      writePaneWidth(cfg, w);
    },
    [cfg],
  );
  const onReset = useCallback(() => {
    setWidth(cfg.def);
    clearPaneWidth(cfg);
  }, [cfg]);
  return { width, onResize, onReset };
}
