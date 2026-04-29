import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, resolveInitialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  describe('resolveInitialTheme', () => {
    it('defaults to dark when nothing is stored and prefers-color-scheme is not light', () => {
      expect(resolveInitialTheme()).toBe('dark');
    });

    it('honors localStorage preference (light)', () => {
      window.localStorage.setItem('minspect.theme', 'light');
      expect(resolveInitialTheme()).toBe('light');
    });

    it('honors localStorage preference (dark)', () => {
      window.localStorage.setItem('minspect.theme', 'dark');
      expect(resolveInitialTheme()).toBe('dark');
    });

    it('ignores invalid localStorage values and falls back', () => {
      window.localStorage.setItem('minspect.theme', 'rainbow');
      expect(resolveInitialTheme()).toBe('dark');
    });
  });

  describe('applyTheme', () => {
    it('sets data-theme="light" when light', () => {
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('removes data-theme when dark (default behavior relies on absence)', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      applyTheme('dark');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });
});
