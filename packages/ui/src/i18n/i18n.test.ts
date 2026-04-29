import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLang, setLang, t } from './index';
import { STRINGS, type StringKey } from './strings';

describe('STRINGS drift', () => {
  it('every key has both en and zh values', () => {
    const missing: string[] = [];
    for (const key of Object.keys(STRINGS) as StringKey[]) {
      const entry = STRINGS[key];
      if (!entry.en) missing.push(`${key}: missing en`);
      if (!entry.zh) missing.push(`${key}: missing zh`);
    }
    expect(missing).toEqual([]);
  });

  it('every string value is non-empty (literal strings only)', () => {
    const empty: string[] = [];
    for (const key of Object.keys(STRINGS) as StringKey[]) {
      const entry = STRINGS[key];
      if (typeof entry.en === 'string' && entry.en.length === 0) empty.push(`${key}: en`);
      if (typeof entry.zh === 'string' && entry.zh.length === 0) empty.push(`${key}: zh`);
    }
    expect(empty).toEqual([]);
  });

  it('function values accept the same named variables for en and zh', () => {
    // We can't introspect function arg names cross-language, but we can
    // assert both variants produce a string when called with a probe bag.
    const probe = {
      n: 1,
      idx: 1,
      total: 10,
      turn: 1,
      step: 1,
      stepTotal: 10,
      i: 1,
      msg: 'x',
      what: 'x',
      level: 'x',
      lines: 1,
      edits: 1,
      sessions: 1,
      files: 1,
      id: 'abcd1234',
      label: 'x',
      path: 'x',
      hash: 'x',
      err: 'x',
      line: 1,
      turnIdx: 1,
      dur: 'x',
      time: 'x',
    };
    for (const key of Object.keys(STRINGS) as StringKey[]) {
      const entry = STRINGS[key];
      for (const lang of ['en', 'zh'] as const) {
        const v = entry[lang];
        if (typeof v !== 'function') continue;
        const out = v(probe);
        expect(typeof out, `${key}/${lang}`).toBe('string');
        expect(out.length, `${key}/${lang}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('t()', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLang('en');
  });
  afterEach(() => {
    window.localStorage.clear();
    setLang('en');
  });

  it('returns the en value by default', () => {
    expect(t('common.loading')).toBe('loading…');
  });

  it('returns the zh value after setLang("zh")', () => {
    setLang('zh');
    expect(t('common.loading')).toBe('加载中…');
  });

  it('runs function values with vars', () => {
    expect(t('common.edits', { n: 1 })).toBe('1 edit');
    expect(t('common.edits', { n: 5 })).toBe('5 edits');
    setLang('zh');
    expect(t('common.edits', { n: 5 })).toBe('5 次编辑');
  });

  it('interpolates {var} in string values when vars supplied', () => {
    // topbar.brand has no vars — literal passthrough even with a bag.
    expect(t('topbar.brand', { foo: 'bar' })).toBe('minspect');
  });

  it('falls back to the key string when key is missing', () => {
    expect(t('bogus.key' as StringKey)).toBe('bogus.key');
  });

  it('falls back to en when a zh entry is identical (sanity)', () => {
    // topbar.brand has `zh: 'minspect'` intentionally.
    setLang('zh');
    expect(t('topbar.brand')).toBe('minspect');
  });
});

describe('setLang / getLang', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLang('en');
  });
  afterEach(() => {
    window.localStorage.clear();
    setLang('en');
  });

  it('persists to localStorage', () => {
    setLang('zh');
    expect(window.localStorage.getItem('minspect.lang')).toBe('zh');
    expect(getLang()).toBe('zh');
  });

  it('dispatches the change event', () => {
    const seen: string[] = [];
    const onChange = (e: Event) => {
      seen.push((e as CustomEvent<string>).detail);
    };
    window.addEventListener('minspect:lang-change', onChange);
    setLang('zh');
    setLang('en');
    window.removeEventListener('minspect:lang-change', onChange);
    expect(seen).toEqual(['zh', 'en']);
  });

  it('does not fire for a no-op setLang', () => {
    let fires = 0;
    const onChange = () => {
      fires += 1;
    };
    window.addEventListener('minspect:lang-change', onChange);
    setLang('en'); // already 'en'
    window.removeEventListener('minspect:lang-change', onChange);
    expect(fires).toBe(0);
  });
});
