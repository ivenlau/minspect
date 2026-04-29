import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getSessionStatePath } from './paths.js';

// Per-session CLI state, persisted across hook invocations so we can correlate
// UserPromptSubmit → PreToolUse → PostToolUse → Stop into the same turn.
export interface SessionState {
  session_id: string;
  turn_idx: number; // next turn idx to use
  current_turn_id: string | null;
  current_turn_started_at: number | null;
  tool_call_idx: number; // idx within current turn
  // PreToolUse stashes file contents here, keyed by file_path. PostToolUse
  // pops them to construct file_edits.
  pretool_before: Record<string, string | null>;
}

function defaultState(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    turn_idx: 0,
    current_turn_id: null,
    current_turn_started_at: null,
    tool_call_idx: 0,
    pretool_before: {},
  };
}

export function readSessionState(sessionId: string, root?: string): SessionState {
  const p = getSessionStatePath(sessionId, root);
  if (!existsSync(p)) return defaultState(sessionId);
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SessionState;
  } catch {
    return defaultState(sessionId);
  }
}

export function writeSessionState(state: SessionState, root?: string): void {
  const p = getSessionStatePath(state.session_id, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}
