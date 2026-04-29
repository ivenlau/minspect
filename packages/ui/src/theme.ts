import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'minspect.theme';
const ATTR = 'data-theme';

// Resolve the starting theme once at module load — avoids a flash of the
// wrong theme on first render. Precedence:
//   1. localStorage (explicit user choice wins)
//   2. prefers-color-scheme
//   3. dark (our historical default)
//
// Exported so tests can verify the resolution logic deterministically.
export function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage blocked (private mode) — fall through */
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// Apply to document root so CSS `[data-theme="light"]` takes effect.
// The default case (dark) just removes the attribute so selectors without
// the attribute match — keeps the CSS file's default block working.
export function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  if (t === 'dark') document.documentElement.removeAttribute(ATTR);
  else document.documentElement.setAttribute(ATTR, t);
}

// Set synchronously on script eval so the first paint already has the right
// palette — otherwise users see a flash of dark before React hydrates.
applyTheme(resolveInitialTheme());

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, setTheme, toggle };
}
