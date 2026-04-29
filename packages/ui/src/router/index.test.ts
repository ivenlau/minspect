import { describe, expect, it } from 'vitest';
import { hrefFor, parseHash } from './index';

describe('parseHash', () => {
  it('empty and "#/" resolve to dashboard', () => {
    expect(parseHash('')).toEqual({ kind: 'dashboard' });
    expect(parseHash('#')).toEqual({ kind: 'dashboard' });
    expect(parseHash('#/')).toEqual({ kind: 'dashboard' });
    expect(parseHash('#/dashboard')).toEqual({ kind: 'dashboard' });
  });

  it('#/timeline → timeline', () => {
    expect(parseHash('#/timeline')).toEqual({ kind: 'timeline' });
  });

  it('parses workspace path (URL-encoded)', () => {
    const hash = `#/ws/${encodeURIComponent('C:\\Users\\admin\\Desktop\\minicode')}`;
    expect(parseHash(hash)).toEqual({
      kind: 'workspace',
      workspace: 'C:\\Users\\admin\\Desktop\\minicode',
    });
  });

  it('parses session with overview tab when no tab in URL', () => {
    const hash = `#/ws/${encodeURIComponent('/home/ws')}/session/abc123`;
    expect(parseHash(hash)).toEqual({
      kind: 'session',
      workspace: '/home/ws',
      session: 'abc123',
      tab: 'overview',
    });
  });

  it('parses session with review/replay/files tab', () => {
    for (const t of ['review', 'replay', 'files'] as const) {
      const hash = `#/ws/${encodeURIComponent('/w')}/session/s1/${t}`;
      expect(parseHash(hash)).toEqual({
        kind: 'session',
        workspace: '/w',
        session: 's1',
        tab: t,
      });
    }
  });

  it('rejects unknown tab, falls back to overview', () => {
    const hash = `#/ws/${encodeURIComponent('/w')}/session/s1/bogus`;
    expect(parseHash(hash)).toEqual({
      kind: 'session',
      workspace: '/w',
      session: 's1',
      tab: 'overview',
    });
  });

  it('parses blame path (file may contain slashes)', () => {
    const hash = `#/ws/${encodeURIComponent('/w')}/file/${encodeURIComponent(
      'packages/collector/src/api.ts',
    )}`;
    expect(parseHash(hash)).toEqual({
      kind: 'blame',
      workspace: '/w',
      file: 'packages/collector/src/api.ts',
    });
  });

  it('routes legacy #/session/:id to legacy-timeline', () => {
    expect(parseHash('#/session/abc')).toMatchObject({ kind: 'legacy-timeline' });
  });

  it('unrecognized paths return not-found', () => {
    expect(parseHash('#/foo/bar')).toMatchObject({ kind: 'not-found' });
  });

  it('strips inner #anchor before routing (Turn timeline click-to-review)', () => {
    const hash = `#/ws/${encodeURIComponent('/w')}/session/s1/review#turn-abc`;
    expect(parseHash(hash)).toEqual({
      kind: 'session',
      workspace: '/w',
      session: 's1',
      tab: 'review',
    });
  });

  it('inner #anchor on a workspace URL also survives', () => {
    expect(parseHash('#/ws/%2Fw#whatever')).toEqual({
      kind: 'workspace',
      workspace: '/w',
    });
  });
});

describe('hrefFor', () => {
  it('round-trips every route kind', () => {
    const cases = [
      { kind: 'dashboard' as const },
      { kind: 'timeline' as const },
      { kind: 'workspace' as const, workspace: '/w' },
      {
        kind: 'session' as const,
        workspace: '/w',
        session: 's',
        tab: 'overview' as const,
      },
      {
        kind: 'session' as const,
        workspace: '/w',
        session: 's',
        tab: 'review' as const,
      },
      { kind: 'blame' as const, workspace: '/w', file: 'a/b.ts' },
    ];
    for (const r of cases) {
      const parsed = parseHash(hrefFor(r));
      expect(parsed).toEqual(r);
    }
  });
});
