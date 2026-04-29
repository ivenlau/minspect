import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSessionState, writeSessionState } from './session-state.js';

describe('session-state', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'minspect-ss-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns defaults when no state file exists', () => {
    const s = readSessionState('sess-1', root);
    expect(s.session_id).toBe('sess-1');
    expect(s.turn_idx).toBe(0);
    expect(s.current_turn_id).toBeNull();
  });

  it('round-trips state across write → read', () => {
    writeSessionState(
      {
        session_id: 's1',
        turn_idx: 3,
        current_turn_id: 't-x',
        current_turn_started_at: 100,
        tool_call_idx: 2,
        pretool_before: { 'a.ts': 'old' },
      },
      root,
    );
    const s = readSessionState('s1', root);
    expect(s.turn_idx).toBe(3);
    expect(s.pretool_before['a.ts']).toBe('old');
  });

  it('two sessions are isolated (one file per session_id)', () => {
    writeSessionState(
      {
        session_id: 'a',
        turn_idx: 1,
        current_turn_id: null,
        current_turn_started_at: null,
        tool_call_idx: 0,
        pretool_before: {},
      },
      root,
    );
    writeSessionState(
      {
        session_id: 'b',
        turn_idx: 5,
        current_turn_id: null,
        current_turn_started_at: null,
        tool_call_idx: 0,
        pretool_before: {},
      },
      root,
    );
    expect(readSessionState('a', root).turn_idx).toBe(1);
    expect(readSessionState('b', root).turn_idx).toBe(5);
  });
});
