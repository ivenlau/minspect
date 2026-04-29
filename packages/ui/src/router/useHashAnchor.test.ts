import { describe, expect, it, vi } from 'vitest';
import { retryScrollToAnchor } from './useHashAnchor';

// Drive virtual time + a queue of scheduled callbacks so each test can
// simulate "element appears at time T" deterministically. Avoids needing a
// full jsdom + React render stack for a pure retry loop.
function makeFakeClock() {
  let nowMs = 0;
  const pending: Array<{ due: number; cb: () => void; handle: number }> = [];
  let nextHandle = 1;
  return {
    now: () => nowMs,
    schedule: (cb: () => void, ms: number) => {
      const h = nextHandle++;
      pending.push({ due: nowMs + ms, cb, handle: h });
      pending.sort((a, b) => a.due - b.due);
      return h;
    },
    cancel: (handle: number) => {
      const i = pending.findIndex((p) => p.handle === handle);
      if (i >= 0) pending.splice(i, 1);
    },
    advance: (ms: number) => {
      const until = nowMs + ms;
      while (pending.length > 0 && pending[0] && pending[0].due <= until) {
        const task = pending.shift();
        if (!task) break;
        nowMs = task.due;
        task.cb();
      }
      nowMs = until;
    },
    pendingCount: () => pending.length,
  };
}

describe('retryScrollToAnchor', () => {
  it('scrolls once the element appears (even if late)', () => {
    const clock = makeFakeClock();
    let el: HTMLElement | null = null;
    const scroll = vi.fn();
    retryScrollToAnchor('turn-abc', {
      findEl: () => el,
      scroll,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    // Initial tick — element doesn't exist yet. No scroll.
    clock.advance(5);
    expect(scroll).not.toHaveBeenCalled();

    // Keep polling — still not there.
    clock.advance(200);
    expect(scroll).not.toHaveBeenCalled();

    // Element appears at ~350ms.
    el = { tagName: 'DIV' } as unknown as HTMLElement;
    clock.advance(200);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith(el);
  });

  it('stops attempting after the timeout even if the element never appears', () => {
    const clock = makeFakeClock();
    const scroll = vi.fn();
    retryScrollToAnchor('nope', {
      findEl: () => null,
      scroll,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      timeoutMs: 500,
      intervalMs: 50,
    });
    clock.advance(10_000);
    expect(scroll).not.toHaveBeenCalled();
    // All retries drained off the queue.
    expect(clock.pendingCount()).toBe(0);
  });

  it('cancel() aborts pending retries (new navigation supersedes)', () => {
    const clock = makeFakeClock();
    const scroll = vi.fn();
    const cancel = retryScrollToAnchor('nope', {
      findEl: () => null,
      scroll,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    cancel();
    clock.advance(10_000);
    expect(scroll).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it('scrolls immediately if the element already exists on the first tick', () => {
    const clock = makeFakeClock();
    const el = { tagName: 'DIV' } as unknown as HTMLElement;
    const scroll = vi.fn();
    retryScrollToAnchor('here', {
      findEl: () => el,
      scroll,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    clock.advance(0);
    expect(scroll).toHaveBeenCalledWith(el);
    expect(clock.pendingCount()).toBe(0); // no further retries queued
  });
});
