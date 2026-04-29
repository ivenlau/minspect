// Tiny fetch wrapper + polling hook. No react-query — the use cases here
// are all "GET once / poll every N seconds"; a dedicated hook is 30 lines
// and makes the data flow obvious.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SessionRow {
  id: string;
  workspace_id: string;
  agent: string;
  agent_version: string | null;
  started_at: number;
  ended_at: number | null;
}

export interface WorkspaceRow {
  path: string;
  session_count: number;
  total_edits: number;
  last_activity: number;
}

export interface QueueStats {
  queue: number;
  poisoned: number;
}

export interface HealthStatus {
  status: 'ok';
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* body wasn't JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

// Matches collector/src/refresh.ts RefreshStepResult.
export interface RefreshStepResult {
  name: 'install-claude-code' | 'install-opencode' | 'import-codex';
  status: 'ok' | 'error' | 'skipped';
  stdout?: string;
  stderr?: string;
  error?: string;
  duration_ms: number;
}

export interface RefreshResult {
  ok: boolean;
  steps: RefreshStepResult[];
  started_at: number;
  ended_at: number;
}

// Polls a URL every `intervalMs` ms and returns the latest value plus loading
// and error state. Cancels in-flight on unmount / url change. In React 18
// StrictMode the effect runs twice in dev; AbortController + ignore flag
// prevent duplicate timers or state writes.
export function usePoll<T>(
  url: string | null,
  intervalMs = 5000,
): { data: T | null; error: Error | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const runRef = useRef<(() => void) | null>(null);
  const ignoreRef = useRef(false);

  useEffect(() => {
    if (!url) return;
    ignoreRef.current = false;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const v = await getJson<T>(url, ctrl.signal);
        if (!ignoreRef.current) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (!ignoreRef.current && (e as Error).name !== 'AbortError') {
          setError(e as Error);
        }
      } finally {
        if (!ignoreRef.current) setLoading(false);
      }
    };

    // Expose the latest `run` to the outer refetch callback without taking
    // it as a dep (which would recreate the timer on every re-render).
    runRef.current = () => {
      void run();
    };
    void run();
    if (intervalMs > 0) {
      timer = setInterval(() => {
        void run();
      }, intervalMs);
    }

    return () => {
      ignoreRef.current = true;
      runRef.current = null;
      ctrl.abort();
      if (timer) clearInterval(timer);
    };
  }, [url, intervalMs]);

  const refetch = useCallback(() => {
    runRef.current?.();
  }, []);

  return { data, error, loading, refetch };
}
