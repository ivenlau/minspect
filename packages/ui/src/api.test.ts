import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getJson } from './api';

describe('getJson', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns parsed JSON on 200', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    const v = await getJson<{ ok: boolean }>('/x');
    expect(v).toEqual({ ok: true });
  });

  it('throws ApiError on non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(getJson('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(getJson('/x')).rejects.toMatchObject({ status: 500 });
  });

  it('passes AbortSignal through', async () => {
    const called: Array<RequestInit | undefined> = [];
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      called.push(init);
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const ctrl = new AbortController();
    await getJson('/x', ctrl.signal);
    expect(called[0]?.signal).toBe(ctrl.signal);
  });
});
