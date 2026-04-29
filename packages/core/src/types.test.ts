import { describe, expect, it } from 'vitest';
import { type Event, EventSchema } from './types.js';

const baseGit = { branch: 'main', head: 'abc123', dirty: false };

describe('EventSchema', () => {
  it('parses session_start', () => {
    const payload: Event = {
      type: 'session_start',
      session_id: 's1',
      agent: 'claude-code',
      agent_version: '2.1.0',
      workspace: '/tmp/repo',
      git: baseGit,
      timestamp: 1_700_000_000_000,
    };
    expect(EventSchema.parse(payload)).toEqual(payload);
  });

  it('parses turn_start', () => {
    const payload: Event = {
      type: 'turn_start',
      session_id: 's1',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'refactor login',
      git: baseGit,
      timestamp: 1_700_000_000_001,
    };
    expect(EventSchema.parse(payload)).toEqual(payload);
  });

  it('parses tool_call with file_edits', () => {
    const payload: Event = {
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't1',
      tool_call_id: 'tc1',
      idx: 0,
      tool_name: 'Edit',
      input: { file: 'a.ts' },
      status: 'ok',
      file_edits: [
        { file_path: 'a.ts', before_content: 'old', after_content: 'new' },
        { file_path: 'b.ts', before_content: null, after_content: 'created' },
      ],
      started_at: 1,
      ended_at: 2,
    };
    expect(EventSchema.parse(payload)).toEqual(payload);
  });

  it('parses turn_end and session_end', () => {
    expect(
      EventSchema.parse({
        type: 'turn_end',
        turn_id: 't1',
        agent_reasoning: 'thinking...',
        timestamp: 3,
      }),
    ).toMatchObject({ type: 'turn_end' });
    expect(
      EventSchema.parse({ type: 'session_end', session_id: 's1', timestamp: 4 }),
    ).toMatchObject({ type: 'session_end' });
  });

  it('rejects unknown type with a field-located error', () => {
    const result = EventSchema.safeParse({ type: 'nope', timestamp: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue).toBeDefined();
      // discriminator issues report the 'type' path
      expect(issue?.path).toContain('type');
    }
  });

  it('rejects missing required field (session_id on session_start)', () => {
    const result = EventSchema.safeParse({
      type: 'session_start',
      agent: 'claude-code',
      workspace: '/tmp/x',
      git: baseGit,
      timestamp: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('session_id');
    }
  });

  it('rejects wrong-type field (timestamp as string)', () => {
    const result = EventSchema.safeParse({
      type: 'session_end',
      session_id: 's1',
      timestamp: 'not-a-number',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('timestamp');
    }
  });
});
