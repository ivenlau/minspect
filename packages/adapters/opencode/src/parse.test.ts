import type { Event } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { emptyOpenCodeState, parseOpenCodeEnvelope } from './parse.js';

// Small helper — wraps a SDK `event` hook payload into the envelope shape the
// plugin side pushes to `minspect capture-opencode`.
function evEnvelope(event: unknown, ts = 1000) {
  return { hookName: 'event' as const, payload: event, timestamp: ts };
}
function toolBeforeEnv(payload: unknown, ts = 1000) {
  return { hookName: 'tool.before' as const, payload, timestamp: ts };
}

describe('parseOpenCodeEnvelope', () => {
  it('session.created → session_start with workspace from info.directory', () => {
    const { events, next } = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: {
          info: { id: 's1', directory: '/ws', time: { created: 500 } },
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'session_start',
      session_id: 's1',
      agent: 'opencode',
      workspace: '/ws',
      timestamp: 500,
    });
    expect(next.session_id).toBe('s1');
    expect(next.workspace).toBe('/ws');
  });

  it('message.updated (user) buffers turn_start; user TextPart flushes it with the real prompt', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;

    // message.updated (user) — buffer, don't emit yet
    const r1 = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    );
    state = r1.next;
    expect(r1.events).toHaveLength(0);
    expect(state.pending_turn_start?.turn_id).toBe('u1');

    // Repeat message.updated for same user message → no-op (dedup)
    const rDup = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1005 } },
        },
      }),
      state,
    );
    expect(rDup.events).toHaveLength(0);
    expect(rDup.next.turn_idx).toBe(1); // unchanged
    state = rDup.next;

    // TextPart for that user → flush turn_start
    const r2 = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'u1',
            type: 'text',
            text: 'please refactor logger',
          },
        },
      }),
      state,
    );
    expect(r2.events).toHaveLength(1);
    const [first] = r2.events;
    if (first?.type !== 'turn_start') throw new Error('expected turn_start');
    expect(first.turn_id).toBe('u1');
    expect(first.user_prompt).toBe('please refactor logger');
    expect(first.idx).toBe(0);
    // pending cleared, dedup marker set
    expect(r2.next.pending_turn_start).toBeUndefined();
  });

  it('message.part.updated (tool, completed) with write → tool_call with file_edits', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;

    const { events, next } = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'a1',
            type: 'tool',
            callID: 'call-1',
            tool: 'write',
            state: {
              status: 'completed',
              input: { file_path: 'src/a.ts', content: 'console.log(1)\n' },
              output: 'File created',
              title: 'write src/a.ts',
              metadata: {},
              time: { start: 1100, end: 1150 },
            },
          },
        },
      }),
      state,
    );
    state = next;
    // Tool executed before user TextPart arrived → parser flushes the
    // buffered turn_start first (empty prompt) then emits tool_call.
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('turn_start');
    const tc = events[1];
    expect(tc?.type).toBe('tool_call');
    if (tc?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(tc.tool_name).toBe('write');
    expect(tc.tool_call_id).toBe('call-1');
    expect(tc.file_edits).toEqual([
      {
        file_path: 'src/a.ts',
        before_content: null,
        after_content: 'console.log(1)\n',
      },
    ]);
    expect(tc.status).toBe('ok');
    expect(tc.started_at).toBe(1100);
    expect(tc.ended_at).toBe(1150);
    // second delivery of same callID → dedup
    const again = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'a1',
            type: 'tool',
            callID: 'call-1',
            tool: 'write',
            state: {
              status: 'completed',
              input: { file_path: 'src/a.ts', content: 'console.log(1)\n' },
              output: 'File created',
              title: 'write src/a.ts',
              metadata: {},
              time: { start: 1100, end: 1150 },
            },
          },
        },
      }),
      state,
    );
    expect(again.events).toHaveLength(0);
  });

  it('tool.before hook + edit tool synthesises after_content from string replace', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;

    // Plugin captured the disk contents before the edit ran.
    state = parseOpenCodeEnvelope(
      toolBeforeEnv({
        tool: 'edit',
        sessionID: 's1',
        callID: 'call-edit',
        args: {
          file_path: 'src/a.ts',
          old_string: 'foo',
          new_string: 'bar',
          _minspect_before_content: 'before\nfoo\nafter\n',
        },
      }),
      state,
    ).next;
    expect(state.before_content_by_call['call-edit']).toBe('before\nfoo\nafter\n');

    const { events } = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'a1',
            type: 'tool',
            callID: 'call-edit',
            tool: 'edit',
            state: {
              status: 'completed',
              input: { file_path: 'src/a.ts', old_string: 'foo', new_string: 'bar' },
              output: 'edited',
              title: 'edit src/a.ts',
              metadata: {},
              time: { start: 1100, end: 1150 },
            },
          },
        },
      }),
      state,
    );
    // Tool fired before user TextPart arrived → pending turn_start flushes
    // first, then tool_call.
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('turn_start');
    const tc = events[1];
    if (tc?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(tc.file_edits).toEqual([
      {
        file_path: 'src/a.ts',
        before_content: 'before\nfoo\nafter\n',
        after_content: 'before\nbar\nafter\n',
      },
    ]);
  });

  it('reasoning + assistant text parts + assistant message complete → turn_end', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };

    ingest({
      type: 'session.created',
      properties: { info: { id: 's1', directory: '/ws' } },
    });
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });
    // assistant starts — no completed yet
    ingest({
      type: 'message.updated',
      properties: {
        info: { id: 'a1', sessionID: 's1', role: 'assistant', time: { created: 1050 } },
      },
    });
    // reasoning part streams in
    ingest({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'rp1',
          sessionID: 's1',
          messageID: 'a1',
          type: 'reasoning',
          text: 'thinking...',
          time: { start: 1060 },
        },
      },
    });
    // final text
    ingest({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'tp1',
          sessionID: 's1',
          messageID: 'a1',
          type: 'text',
          text: 'done!',
        },
      },
    });
    // assistant "completed" fires but does NOT emit turn_end (multi-step
    // responses need to accumulate across all assistant messages).
    const midOut = ingest(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'a1',
            sessionID: 's1',
            role: 'assistant',
            time: { created: 1050, completed: 1200 },
          },
        },
      },
      1200,
    );
    expect(midOut).toHaveLength(0);

    // session.idle → turn_start flushes + turn_end fires with accumulated text
    const out = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1300);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('turn_start');
    const te = out[1];
    if (te?.type !== 'turn_end') throw new Error('expected turn_end');
    expect(te.turn_id).toBe('u1');
    expect(te.agent_reasoning).toBe('thinking...');
    expect(te.agent_final_message).toBe('done!');
    expect(te.timestamp).toBe(1300);
  });

  it('multi-step assistant (plan → tool → review): reasoning from both parts is joined at turn_end', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };

    ingest({ type: 'session.created', properties: { info: { id: 's1', directory: '/ws' } } });
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });

    // Assistant #1 — plans
    ingest({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'rp-A',
          sessionID: 's1',
          messageID: 'a1',
          type: 'reasoning',
          text: 'I will edit first',
          time: { start: 1050, end: 1100 },
        },
      },
    });
    ingest({
      type: 'message.updated',
      properties: {
        info: {
          id: 'a1',
          sessionID: 's1',
          role: 'assistant',
          time: { created: 1050, completed: 1100 },
        },
      },
    });

    // Assistant #2 — reviews + final message
    ingest({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'rp-B',
          sessionID: 's1',
          messageID: 'a2',
          type: 'reasoning',
          text: 'Now verify',
          time: { start: 1150, end: 1200 },
        },
      },
    });
    ingest({
      type: 'message.part.updated',
      properties: {
        part: { id: 'tp-B', sessionID: 's1', messageID: 'a2', type: 'text', text: 'Done!' },
      },
    });
    ingest({
      type: 'message.updated',
      properties: {
        info: {
          id: 'a2',
          sessionID: 's1',
          role: 'assistant',
          time: { created: 1150, completed: 1200 },
        },
      },
    });

    // session.idle → single turn_end with BOTH reasonings joined
    const out = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1250);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('turn_start');
    const te = out[1];
    if (te?.type !== 'turn_end') throw new Error('expected turn_end');
    expect(te.agent_reasoning).toContain('I will edit first');
    expect(te.agent_reasoning).toContain('Now verify');
    expect(te.agent_final_message).toBe('Done!');
  });

  it('session.idle fired twice → second is a no-op (dedup)', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };
    ingest({ type: 'session.created', properties: { info: { id: 's1', directory: '/ws' } } });
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });
    const first = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1100);
    expect(first.length).toBeGreaterThan(0);
    const second = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1200);
    expect(second).toHaveLength(0);
  });

  it('session.deleted → session_end', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;

    const { events } = parseOpenCodeEnvelope(
      evEnvelope({ type: 'session.deleted', properties: { sessionID: 's1' } }, 9999),
      state,
    );
    expect(events).toEqual<Event[]>([{ type: 'session_end', session_id: 's1', timestamp: 9999 }]);
  });

  it('unknown event.type → empty events, no throw', () => {
    const { events, warnings } = parseOpenCodeEnvelope(
      evEnvelope({ type: 'session.idle', properties: { sessionID: 's1' } }),
    );
    expect(events).toHaveLength(0);
    expect(warnings).toEqual([]);
  });

  it('malformed envelope → empty events with warning', () => {
    const { events, warnings } = parseOpenCodeEnvelope({ not: 'valid' });
    expect(events).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/skip:invalid_envelope/);
  });

  it('tool.execute.after hook emits tool_call (primary path) with file_edits from before-hook snapshot', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;
    // before hook captures disk content + started_at
    state = parseOpenCodeEnvelope(
      {
        hookName: 'tool.before',
        payload: {
          tool: 'edit',
          sessionID: 's1',
          callID: 'call-X',
          args: {
            file_path: 'src/a.ts',
            old_string: 'foo',
            new_string: 'bar',
            _minspect_before_content: 'hello foo world',
          },
        },
        timestamp: 1100,
      },
      state,
    ).next;
    expect(state.tool_started_at_by_call['call-X']).toBe(1100);

    // after hook triggers tool_call emission
    const { events } = parseOpenCodeEnvelope(
      {
        hookName: 'tool.after',
        payload: {
          tool: 'edit',
          sessionID: 's1',
          callID: 'call-X',
          args: { file_path: 'src/a.ts', old_string: 'foo', new_string: 'bar' },
          output: { title: 'edit', output: 'patched', metadata: {} },
        },
        timestamp: 1150,
      },
      state,
    );
    // flushes buffered turn_start + tool_call
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('turn_start');
    const tc = events[1];
    if (tc?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(tc.tool_name).toBe('edit');
    expect(tc.tool_call_id).toBe('call-X');
    expect(tc.started_at).toBe(1100);
    expect(tc.ended_at).toBe(1150);
    expect(tc.file_edits).toEqual([
      {
        file_path: 'src/a.ts',
        before_content: 'hello foo world',
        after_content: 'hello bar world',
      },
    ]);
  });

  it('extractFileEdits accepts OpenCode camelCase arg names (filePath / oldString / newString)', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      {
        hookName: 'tool.before',
        payload: {
          tool: 'edit',
          sessionID: 's1',
          callID: 'c1',
          args: {
            filePath: 'a.txt',
            oldString: 'i love you',
            newString: 'I LOVE YOU',
            _minspect_before_content: 'hello\ni love you\nworld\n',
          },
        },
        timestamp: 1100,
      },
      state,
    ).next;
    const { events } = parseOpenCodeEnvelope(
      {
        hookName: 'tool.after',
        payload: {
          tool: 'edit',
          sessionID: 's1',
          callID: 'c1',
          args: { filePath: 'a.txt', oldString: 'i love you', newString: 'I LOVE YOU' },
          output: { title: 'edit a.txt', output: 'patched', metadata: {} },
        },
        timestamp: 1200,
      },
      state,
    );
    expect(events).toHaveLength(2);
    const tc = events[1];
    if (tc?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(tc.file_edits).toEqual([
      {
        file_path: 'a.txt',
        before_content: 'hello\ni love you\nworld\n',
        after_content: 'hello\nI LOVE YOU\nworld\n',
      },
    ]);
  });

  it('late-arriving user TextPart (after session.idle) retroactively fills prompt', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };

    ingest({ type: 'session.created', properties: { info: { id: 's1', directory: '/ws' } } });
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });
    // session.idle arrives BEFORE the user's TextPart → turn_start flushes
    // with empty prompt, turn_end fires.
    const idle = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1100);
    expect(idle).toHaveLength(2);
    expect(idle[0]?.type).toBe('turn_start');
    expect((idle[0] as { user_prompt?: string }).user_prompt).toBe('');
    expect(idle[1]?.type).toBe('turn_end');

    // Now the user's TextPart arrives late. The parser should retroactively
    // update the turn_start event that was already emitted.
    // But since `out` was returned and consumed, the late text gets buffered.
    // On the NEXT turn_start emission, it should be used.
    // Actually — the `out` array from idle is already returned. We need to
    // test the state-level buffering instead.
    // The late text part matches u1 which is still current_turn_id.
    const late = ingest(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p-late',
            sessionID: 's1',
            messageID: 'u1',
            type: 'text',
            text: 'actual user prompt',
          },
        },
      },
      1150,
    );
    // No events emitted — text is buffered for next turn_start.
    expect(late).toHaveLength(0);
    expect(state.pending_user_text).toBe('actual user prompt');

    // Next turn: the buffered text should be used.
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u2', sessionID: 's1', role: 'user', time: { created: 2000 } } },
    });
    const nextIdle = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 2100);
    expect(nextIdle).toHaveLength(2);
    expect(nextIdle[0]?.type).toBe('turn_start');
    expect((nextIdle[0] as { user_prompt?: string }).user_prompt).toBe('actual user prompt');
    expect(state.pending_user_text).toBeUndefined();
  });

  it('tool.execute.after with _minspect_before_content in args uses it for file_edits', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;

    // No tool.before hook — but tool.after includes _minspect_before_content
    // directly in args (plugin-side caching).
    const { events } = parseOpenCodeEnvelope(
      {
        hookName: 'tool.after',
        payload: {
          tool: 'edit',
          sessionID: 's1',
          callID: 'call-cached',
          args: {
            filePath: 'a.txt',
            oldString: 'old',
            newString: 'new',
            _minspect_before_content: 'before old after',
          },
          output: { title: 'edit', output: 'patched', metadata: {} },
        },
        timestamp: 1150,
      },
      state,
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('turn_start');
    const tc = events[1];
    if (tc?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(tc.file_edits).toEqual([
      {
        file_path: 'a.txt',
        before_content: 'before old after',
        after_content: 'before new after',
      },
    ]);
  });

  it('late-arriving user TextPart (after tool_call flushed turn_start) carries prompt in turn_end', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };

    ingest({ type: 'session.created', properties: { info: { id: 's1', directory: '/ws' } } });
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });

    // Tool arrives BEFORE user TextPart → flushes turn_start with empty prompt
    const toolOut = ingest(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'a1',
            type: 'tool',
            callID: 'c1',
            tool: 'write',
            state: {
              status: 'completed',
              input: { file_path: 'a.txt', content: 'hi' },
              output: 'done',
              title: 'write a.txt',
              metadata: {},
              time: { start: 1100, end: 1150 },
            },
          },
        },
      },
      1150,
    );
    expect(toolOut[0]?.type).toBe('turn_start');
    expect((toolOut[0] as { user_prompt?: string }).user_prompt).toBe('');

    // User TextPart arrives late → buffered as pending_user_text
    ingest(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p-late',
            sessionID: 's1',
            messageID: 'u1',
            type: 'text',
            text: 'please write a file',
          },
        },
      },
      1200,
    );
    expect(state.pending_user_text).toBe('please write a file');

    // session.idle → turn_end should carry the user_prompt
    const idle = ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1300);
    const te = idle.find((e) => e.type === 'turn_end');
    expect(te).toBeDefined();
    if (te?.type !== 'turn_end') throw new Error('expected turn_end');
    expect(te.user_prompt).toBe('please write a file');
    expect(state.pending_user_text).toBeUndefined();
  });

  it('user TextPart arriving before message.updated is cached and flushed', () => {
    let state = emptyOpenCodeState();
    const ingest = (evt: unknown, ts = 1000) => {
      const r = parseOpenCodeEnvelope(evEnvelope(evt, ts), state);
      state = r.next;
      return r.events;
    };

    ingest({ type: 'session.created', properties: { info: { id: 's1', directory: '/ws' } } });

    // First turn: message.updated THEN TextPart (normal order)
    ingest({
      type: 'message.updated',
      properties: { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } } },
    });
    ingest(
      {
        type: 'message.part.updated',
        properties: {
          part: { id: 'p1', sessionID: 's1', messageID: 'u1', type: 'text', text: 'first prompt' },
        },
      },
      1050,
    );
    // Flush turn
    ingest(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'a1',
            sessionID: 's1',
            role: 'assistant',
            time: { created: 1100, completed: 1200 },
          },
        },
      },
      1200,
    );
    ingest({ type: 'session.idle', properties: { sessionID: 's1' } }, 1300);

    // Second turn: TextPart arrives BEFORE message.updated
    const earlyText = ingest(
      {
        type: 'message.part.updated',
        properties: {
          part: { id: 'p2', sessionID: 's1', messageID: 'u2', type: 'text', text: 'early prompt' },
        },
      },
      2000,
    );
    // TextPart should be cached, no turn_start emitted yet
    expect(earlyText).toHaveLength(0);
    expect(state.pending_text_by_message['u2']).toBe('early prompt');

    // Now message.updated arrives — should flush immediately with the cached text
    const mu = ingest(
      {
        type: 'message.updated',
        properties: { info: { id: 'u2', sessionID: 's1', role: 'user', time: { created: 2100 } } },
      },
      2100,
    );
    expect(mu).toHaveLength(1);
    expect(mu[0]?.type).toBe('turn_start');
    expect((mu[0] as { user_prompt?: string }).user_prompt).toBe('early prompt');
    expect(state.pending_text_by_message['u2']).toBeUndefined();
  });

  it('tool status=error maps to tool_call with status=error', () => {
    let state = emptyOpenCodeState();
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'session.created',
        properties: { info: { id: 's1', directory: '/ws' } },
      }),
      state,
    ).next;
    state = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.updated',
        properties: {
          info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 } },
        },
      }),
      state,
    ).next;

    const { events } = parseOpenCodeEnvelope(
      evEnvelope({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'a1',
            type: 'tool',
            callID: 'c1',
            tool: 'bash',
            state: {
              status: 'error',
              input: { command: 'false' },
              time: { start: 1100, end: 1110 },
            },
          },
        },
      }),
      state,
    );
    // Tool fired before user TextPart → pending turn_start flushes first.
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('turn_start');
    if (events[1]?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(events[1].status).toBe('error');
    expect(events[1].tool_name).toBe('bash');
  });
});
