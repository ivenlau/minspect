import { useEffect } from 'react';

// Defaults tuned for ReviewPage — the heaviest target of hash anchors today.
// `/api/review` with a populated DB resolves in ~30-200ms, and virtualization
// isn't in play here so the DOM is painted in one pass once data lands. 3s
// window covers slow boxes; 80ms polling feels instant in practice.
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_INTERVAL_MS = 80;

export interface RetryScrollOptions {
  findEl: (id: string) => HTMLElement | null;
  scroll: (el: HTMLElement) => void;
  now?: () => number;
  schedule?: (cb: () => void, ms: number) => number;
  cancel?: (handle: number) => void;
  timeoutMs?: number;
  intervalMs?: number;
}

// Extracted and DOM-free so the retry logic can be unit-tested without a
// full React + @testing-library stack. Repeatedly calls `findEl(id)` until
// it returns non-null and we've scrolled, or the timeout fires. Returns a
// cancel function the caller should invoke on unmount / new navigation.
export function retryScrollToAnchor(id: string, opts: RetryScrollOptions): () => void {
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? ((cb, ms) => setTimeout(cb, ms) as unknown as number);
  const cancel =
    opts.cancel ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = now() + timeoutMs;
  let handle: number | null = null;
  let cancelled = false;

  const attempt = () => {
    if (cancelled) return;
    handle = null;
    const el = opts.findEl(id);
    if (el) {
      opts.scroll(el);
      return;
    }
    if (now() < deadline) handle = schedule(attempt, intervalMs);
  };
  handle = schedule(attempt, 0); // first tick: next microtask / next frame

  return () => {
    cancelled = true;
    if (handle != null) cancel(handle);
  };
}

// Scrolls `document.getElementById(hashAnchor)` into view whenever the URL
// fragment contains a `#anchor` after the route path. Session overview
// links to `.../review#turn-<id>` — without this hook, the Review page
// loads but never scrolls to the target turn.
//
// The anchor target is usually rendered *after* the page's initial data
// fetch (ReviewPage renders turn cards once `/api/review` resolves), so a
// single `rAF` call is too early — `getElementById` returns null and we
// never retry. Instead we poll on a short interval until the element
// appears or the timeout fires (see `retryScrollToAnchor`).
export function useHashAnchor(): void {
  useEffect(() => {
    let cancelPending: (() => void) | null = null;
    const scrollToAnchor = () => {
      // location.hash looks like '#/path/to/page#inner-anchor'. We want
      // everything after the LAST '#'.
      const raw = window.location.hash;
      const idx = raw.lastIndexOf('#');
      if (idx <= 0) return; // only the route '#', no inner anchor
      const inner = raw.slice(idx + 1);
      if (!inner) return;

      // A new navigation supersedes any still-running retry loop from the
      // previous hashchange — don't have two concurrent scroll attempts.
      if (cancelPending) cancelPending();

      cancelPending = retryScrollToAnchor(inner, {
        findEl: (id) => document.getElementById(id),
        scroll: (el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      });
    };

    scrollToAnchor();
    window.addEventListener('hashchange', scrollToAnchor);
    return () => {
      window.removeEventListener('hashchange', scrollToAnchor);
      if (cancelPending) cancelPending();
    };
  }, []);
}
