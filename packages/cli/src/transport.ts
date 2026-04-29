import { existsSync, readFileSync } from 'node:fs';
import type { Event } from '@minspect/core';
import { spawnServeDetached } from './commands/serve.js';
import { readConfig } from './config.js';
import { getStateFilePath } from './paths.js';
import { enqueueEvent, listQueued, quarantineQueued, readQueued, removeQueued } from './queue.js';

export interface CollectorTarget {
  port: number;
  host?: string;
}

export function readCollectorTarget(root?: string): CollectorTarget | null {
  const p = getStateFilePath(root);
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as { port?: number };
    if (typeof s.port !== 'number') return null;
    return { port: s.port, host: '127.0.0.1' };
  } catch {
    return null;
  }
}

// Tri-state POST outcome — matters because the queue drainer has to decide
// between "retry later" (network/offline) and "give up on this event"
// (permanent validation / FK failure). Treating them the same is what caused
// the 1799-event poison backlog this file fixes.
type PostOutcome = 'ok' | 'transient' | 'permanent';

async function postOne(
  event: Event,
  target: CollectorTarget,
  timeoutMs = 500,
): Promise<PostOutcome> {
  const url = `http://${target.host ?? '127.0.0.1'}:${target.port}/events`;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (res.ok) return 'ok';
    // 4xx/5xx from the collector = this event will never succeed (schema
    // validation or missing-FK). Don't block the queue waiting for it.
    // Note: we map 5xx to permanent because our collector only 500s on
    // logic errors (e.g. unknown session_id), not on transient crashes;
    // if the server is actually crashing, fetch() throws and we hit the
    // catch branch below.
    return 'permanent';
  } catch {
    return 'transient';
  } finally {
    clearTimeout(to);
  }
}

// Detach-spawn `minspect serve --quiet` when config.auto_spawn_daemon is on
// and no daemon is running. Fire-and-forget: we don't wait for the server
// to come up, so the hook keeps its ≤100 ms SLA. The daemon, once listening,
// drains the disk queue we're about to write to anyway.
function maybeSpawnDaemon(root?: string): void {
  const cfg = readConfig(root);
  if (!cfg.auto_spawn_daemon) return;
  // Hook never blocks. spawnServeDetached swallows its own errors and
  // returns null — on failure the event is already on its way to the disk
  // queue below, and the daemon drains on next manual start.
  spawnServeDetached({ spawnedBy: 'hook' });
}

// Try to POST event. If collector is down/unreachable, queue to disk.
// Drain any previously queued events first:
//   - ok        → remove from queue
//   - permanent → move to .poison/ (preserved for inspection, unblocks queue)
//   - transient → stop draining; queue current event too
export async function sendEvent(event: Event, root?: string): Promise<'sent' | 'queued'> {
  const target = readCollectorTarget(root);
  if (!target) {
    maybeSpawnDaemon(root);
    enqueueEvent(event, root);
    return 'queued';
  }
  for (const f of listQueued(root)) {
    const queued = readQueued(f);
    const outcome = await postOne(queued, target);
    if (outcome === 'ok') {
      removeQueued(f);
    } else if (outcome === 'permanent') {
      quarantineQueued(f, root);
    } else {
      // transient — network / daemon gone mid-drain
      enqueueEvent(event, root);
      return 'queued';
    }
  }
  const outcome = await postOne(event, target);
  if (outcome === 'ok') return 'sent';
  if (outcome === 'permanent') {
    // Event is unrecoverable — still stash it for inspection so we don't lose
    // it silently. enqueue + immediate quarantine (via the same filename path).
    const f = enqueueEvent(event, root);
    quarantineQueued(f, root);
    return 'queued';
  }
  // transient
  enqueueEvent(event, root);
  return 'queued';
}
