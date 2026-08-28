import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSPECTOR_PANE,
  SIDEBAR_PANE,
  clampWidth,
  clearPaneWidth,
  readPaneWidth,
  writePaneWidth,
} from './paneWidths';

describe('paneWidths', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns defaults when nothing persisted', () => {
    expect(readPaneWidth(SIDEBAR_PANE)).toBe(240);
    expect(readPaneWidth(INSPECTOR_PANE)).toBe(320);
  });

  it('round-trips a persisted width', () => {
    writePaneWidth(SIDEBAR_PANE, 320.7);
    expect(readPaneWidth(SIDEBAR_PANE)).toBe(321);
  });

  it('clamps stale out-of-range values on read', () => {
    writePaneWidth(SIDEBAR_PANE, 5000);
    expect(readPaneWidth(SIDEBAR_PANE)).toBe(SIDEBAR_PANE.max);
    writePaneWidth(SIDEBAR_PANE, 1);
    expect(readPaneWidth(SIDEBAR_PANE)).toBe(SIDEBAR_PANE.min);
  });

  it('falls back to default on non-numeric junk', () => {
    window.localStorage.setItem(INSPECTOR_PANE.storageKey, 'wide');
    expect(readPaneWidth(INSPECTOR_PANE)).toBe(INSPECTOR_PANE.def);
  });

  it('clampWidth respects min/max', () => {
    expect(clampWidth(INSPECTOR_PANE, 10)).toBe(INSPECTOR_PANE.min);
    expect(clampWidth(INSPECTOR_PANE, 9999)).toBe(INSPECTOR_PANE.max);
    expect(clampWidth(INSPECTOR_PANE, 400)).toBe(400);
  });

  it('clearPaneWidth removes the stored value', () => {
    writePaneWidth(SIDEBAR_PANE, 300);
    clearPaneWidth(SIDEBAR_PANE);
    expect(window.localStorage.getItem(SIDEBAR_PANE.storageKey)).toBeNull();
  });
});
