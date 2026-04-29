// Hash-based router. Parses `#/segment/:param?query=...` into a typed
// Route union so pages can switch on kind without manual string matching.
//
// Why hash: keeps the collector dumb — no history-API fallback routing,
// any GET `/` returns index.html, client resolves the rest. Also survives
// file:// loads if we ever ship a static export.

import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'timeline' }
  | { kind: 'dashboard' }
  | { kind: 'workspace'; workspace: string }
  | {
      kind: 'session';
      workspace: string;
      session: string;
      tab: 'overview' | 'review' | 'replay' | 'files';
    }
  | { kind: 'blame'; workspace: string; file: string }
  | { kind: 'legacy-timeline'; hash: string } // for '#/session/:id' legacy links
  | { kind: 'not-found'; raw: string };

export function parseHash(hash: string): Route {
  // Strip leading '#'. Then strip off an optional inner '#anchor' — we use
  // that to scroll-to-element (see `useHashAnchor`), and the routing parser
  // must not see it. Without this, a URL like
  //   #/ws/X/session/Y/review#turn-Z
  // breaks because parts[4] becomes "review#turn-Z" which doesn't match the
  // tab whitelist; parseHash falls back to 'overview' and the click appears
  // to do nothing.
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  const anchorIdx = h.indexOf('#');
  if (anchorIdx >= 0) h = h.slice(0, anchorIdx);
  // Split path from ?query
  const [pathPart, queryPart] = h.split('?');
  const path = (pathPart ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  const query = new URLSearchParams(queryPart ?? '');

  if (path === '' || path === 'dashboard') return { kind: 'dashboard' };
  if (path === 'timeline') return { kind: 'timeline' };

  const parts = path.split('/');
  if (parts[0] === 'ws' && parts.length >= 2) {
    const workspace = decodeURIComponent(parts[1] ?? '');
    if (parts.length === 2) return { kind: 'workspace', workspace };
    if (parts[2] === 'session' && parts.length >= 4) {
      const session = decodeURIComponent(parts[3] ?? '');
      const tabRaw = parts[4] ?? 'overview';
      const tab: 'overview' | 'review' | 'replay' | 'files' =
        tabRaw === 'review' || tabRaw === 'replay' || tabRaw === 'files' ? tabRaw : 'overview';
      return { kind: 'session', workspace, session, tab };
    }
    if (parts[2] === 'file' && parts.length >= 4) {
      const file = decodeURIComponent(parts.slice(3).join('/'));
      return { kind: 'blame', workspace, file };
    }
  }

  // Legacy shape: '#/session/:id' used by the vanilla app.
  if (parts[0] === 'session' && parts[1]) {
    return { kind: 'legacy-timeline', hash: h };
  }
  // Filter state on review/replay is read from query by the page itself.
  void query;

  return { kind: 'not-found', raw: h };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

export function hrefFor(route: Route): string {
  switch (route.kind) {
    case 'timeline':
      return '#/timeline';
    case 'dashboard':
      return '#/';
    case 'workspace':
      return `#/ws/${encodeURIComponent(route.workspace)}`;
    case 'session':
      return `#/ws/${encodeURIComponent(route.workspace)}/session/${encodeURIComponent(route.session)}${route.tab === 'overview' ? '' : `/${route.tab}`}`;
    case 'blame':
      return `#/ws/${encodeURIComponent(route.workspace)}/file/${encodeURIComponent(route.file)}`;
    default:
      return '#/';
  }
}
