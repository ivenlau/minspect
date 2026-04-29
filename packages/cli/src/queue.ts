import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import type { Event } from '@minspect/core';
import { getQueueDir } from './paths.js';

// Disk-backed event queue used when the collector is unreachable.
// On next successful POST attempt the CLI drains this queue first.

export function enqueueEvent(event: Event, root?: string): string {
  const dir = getQueueDir(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(event));
  return file;
}

export function listQueued(root?: string): string[] {
  const dir = getQueueDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

export function readQueued(file: string): Event {
  return JSON.parse(readFileSync(file, 'utf8')) as Event;
}

export function removeQueued(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // ignore — best effort
  }
}

// Move an event we know the collector will never accept (validation / FK
// errors — e.g. tool_call whose session_start was lost) into a sibling
// `.poison/` dir so it doesn't block the rest of the queue forever. We keep
// the file around for inspection instead of deleting.
export function quarantineQueued(file: string, root?: string): void {
  try {
    const dir = getQueueDir(root);
    const poisonDir = join(dir, '.poison');
    mkdirSync(poisonDir, { recursive: true });
    renameSync(file, join(poisonDir, basename(file)));
  } catch {
    // Last resort: if rename fails (e.g. cross-volume), just unlink.
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}
