import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type OpenCodeParserState, emptyOpenCodeState } from '@minspect/adapter-opencode';
import { getStateDir } from './paths.js';

// OpenCode state lives alongside Claude-Code session state but under its own
// filename prefix so the two can coexist in the same <state_dir>/sessions/
// directory without colliding on the rare chance their session IDs clash.
export function pathFor(sessionId: string, root: string = getStateDir()): string {
  return join(root, 'sessions', `opencode-${sessionId}.json`);
}

// Per-session file lock so multiple `minspect capture-opencode` processes
// (spawned by the OpenCode plugin — one per hook fire) don't clobber each
// other's read-modify-write on the state file. Without this, fast bursts of
// part updates race; some processes read state BEFORE an earlier process
// wrote its update, then overwrite — state-file updates get lost.
export async function withOpenCodeStateLock<T>(
  sessionId: string,
  root: string | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  const lockPath = `${pathFor(sessionId, root)}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const timeoutMs = 5000;
  const started = Date.now();
  // Reap stale locks first — older than 10s is assumed to be a crashed
  // capture-opencode that never cleaned up.
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > 10_000) unlinkSync(lockPath);
  } catch {
    /* no lockfile — ignore */
  }
  while (Date.now() - started < timeoutMs) {
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 20)));
      continue;
    }
    try {
      return await fn();
    } finally {
      try {
        if (fd !== null) closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`opencode state lock timeout: ${lockPath}`);
}

export function readOpenCodeState(sessionId: string, root?: string): OpenCodeParserState {
  const p = pathFor(sessionId, root);
  if (!existsSync(p)) return emptyOpenCodeState();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as OpenCodeParserState;
    // Defensive defaults for missing fields on upgrade paths.
    return {
      ...emptyOpenCodeState(),
      ...parsed,
      reasoning_by_part_id: parsed.reasoning_by_part_id ?? {},
      text_by_part_id: parsed.text_by_part_id ?? {},
      before_content_by_call: parsed.before_content_by_call ?? {},
      tool_started_at_by_call: parsed.tool_started_at_by_call ?? {},
      emitted_tool_call_ids: parsed.emitted_tool_call_ids ?? [],
    };
  } catch {
    return emptyOpenCodeState();
  }
}

export function writeOpenCodeState(
  sessionId: string,
  state: OpenCodeParserState,
  root?: string,
): void {
  const p = pathFor(sessionId, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}
