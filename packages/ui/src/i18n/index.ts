import { useEffect, useState } from 'react';
import { STRINGS, type StringKey } from './strings';

export type Lang = 'en' | 'zh';
const STORAGE_KEY = 'minspect.lang';
const CHANGE_EVENT = 'minspect:lang-change';

// Resolve the starting language once at module load so the first paint
// already uses the right strings. Precedence: stored choice > browser's
// primary language prefix > English.
function resolveInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    /* blocked */
  }
  const nav = typeof navigator !== 'undefined' ? (navigator.language ?? 'en').toLowerCase() : 'en';
  if (nav.startsWith('zh')) return 'zh';
  return 'en';
}

// Module-level state. `t()` reads this directly so helpers like `formatBucket`
// that don't sit inside React components can still access the current lang.
// `useLang` subscribes to the change event and re-renders consumers.
let currentLang: Lang = resolveInitialLang();

// Low-level translate. Accepts a dot-qualified key plus optional interp
// vars. Missing keys fall back to English; missing-in-both returns the key
// itself so dev notices the gap.
export function t(key: StringKey, vars?: Record<string, unknown>): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  const value = entry[currentLang] ?? entry.en;
  if (typeof value === 'function') {
    return value(vars ?? {});
  }
  if (vars && typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? `{${v}}`));
  }
  return value;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* blocked */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: lang }));
}

// Subscribe a component to language changes. Returned `t` binds to the
// current language automatically — you don't need to re-read `getLang()`.
export function useLang(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, unknown>) => string;
} {
  const [lang, setLangState] = useState(currentLang);
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Lang>).detail;
      setLangState(next);
    };
    window.addEventListener(CHANGE_EVENT, onChange as EventListener);
    return () => window.removeEventListener(CHANGE_EVENT, onChange as EventListener);
  }, []);
  return {
    lang,
    setLang,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    t: (key, vars) => {
      void lang; // keep lang as dependency so effect-less components still track it
      return t(key, vars);
    },
  };
}

export type { StringKey } from './strings';
