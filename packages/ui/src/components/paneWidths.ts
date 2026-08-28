// Pane-width persistence shared by the ThreePane layout. Kept as plain
// functions (not a hook) so they're trivially unit-testable.

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
