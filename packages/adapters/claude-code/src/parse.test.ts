import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { ParseError, parse } from './parse.js';
import type { ClaudeCodePayload, ParseContext } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): ClaudeCodePayload {
  const p = resolve(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf8')) as ClaudeCodePayload;
}

const git: GitState = { branch: 'main', head: 'deadbeef', dirty: false };

const baseCtx: ParseContext = {
  timestamp: 1_700_000_000_000,
  git,
};

describe('parse', () => {
  it('SessionStart → session_start event', () => {
    const events = parse(loadFixture('session_start'), baseCtx);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('session_start');
    if (e?.type === 'session_start') {
      expect(e.session_id).toBe('sess-abc123');
      expect(e.agent).toBe('claude-code');
      expect(e.workspace).toBe('/home/dev/myrepo');
    }
  });

  it('UserPromptSubmit → turn_start with user_prompt verbatim', () => {
    const events = parse(loadFixture('user_prompt_submit'), {
      ...baseCtx,
      turn_id: 't1',
      turn_idx: 0,
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('turn_start');
    if (e?.type === 'turn_start') {
      expect(e.user_prompt).toBe('Refactor the login flow to use JWT.');
      expect(e.turn_id).toBe('t1');
      expect(e.idx).toBe(0);
    }
  });

  it('PostToolUse Edit → tool_call with before/after from ctx.file_edits', () => {
    const events = parse(loadFixture('post_tool_edit'), {
      ...baseCtx,
      turn_id: 't1',
      tool_call_id: 'tc1',
      tool_call_idx: 0,
      file_edits: [
        {
          file_path: '/home/dev/myrepo/src/auth.ts',
          before_content: 'export function login(user) { return session(user) }',
          after_content: 'export function login(user) { return jwt.sign(user) }',
        },
      ],
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('tool_call');
    if (e?.type === 'tool_call') {
      expect(e.tool_name).toBe('Edit');
      expect(e.file_edits).toHaveLength(1);
      expect(e.file_edits?.[0]?.before_content).toContain('session');
      expect(e.file_edits?.[0]?.after_content).toContain('jwt.sign');
    }
  });

  it('PostToolUse MultiEdit → tool_call preserving multi file_edits', () => {
    const events = parse(loadFixture('post_tool_multiedit'), {
      ...baseCtx,
      turn_id: 't1',
      tool_call_id: 'tc2',
      tool_call_idx: 1,
      file_edits: [
        {
          file_path: '/home/dev/myrepo/src/auth.ts',
          before_content: 'import { session }\nsession(user)',
          after_content: 'import { jwt }\njwt.sign(user)',
        },
      ],
    });
    const e = events[0];
    if (e?.type === 'tool_call') {
      expect(e.tool_name).toBe('MultiEdit');
      expect(e.file_edits?.[0]?.after_content).toContain('jwt');
    }
  });

  it('PostToolUse Write (new file) → tool_call with null before_content', () => {
    const events = parse(loadFixture('post_tool_write'), {
      ...baseCtx,
      turn_id: 't1',
      tool_call_id: 'tc3',
      tool_call_idx: 2,
      file_edits: [
        {
          file_path: '/home/dev/myrepo/src/jwt.ts',
          before_content: null,
          after_content: "export const jwt = { sign: (u) => '<token>' };\n",
        },
      ],
    });
    const e = events[0];
    if (e?.type === 'tool_call') {
      expect(e.file_edits?.[0]?.before_content).toBeNull();
    }
  });

  it('PostToolUse Bash → tool_call with no file_edits', () => {
    const events = parse(loadFixture('post_tool_bash'), {
      ...baseCtx,
      turn_id: 't1',
      tool_call_id: 'tc4',
      tool_call_idx: 3,
    });
    const e = events[0];
    expect(e?.type).toBe('tool_call');
    if (e?.type === 'tool_call') {
      expect(e.tool_name).toBe('Bash');
      expect(e.file_edits).toBeUndefined();
    }
  });

  it('PreToolUse returns no events (capture-only)', () => {
    const events = parse(
      { ...loadFixture('post_tool_edit'), hook_event_name: 'PreToolUse' },
      baseCtx,
    );
    expect(events).toEqual([]);
  });

  it('Stop → turn_end', () => {
    const events = parse(loadFixture('stop'), {
      ...baseCtx,
      turn_id: 't1',
      agent_reasoning: 'thinking...',
      agent_final_message: 'done',
    });
    const e = events[0];
    expect(e?.type).toBe('turn_end');
    if (e?.type === 'turn_end') {
      expect(e.agent_reasoning).toBe('thinking...');
      expect(e.agent_final_message).toBe('done');
    }
  });

  it('missing required field throws ParseError with field name', () => {
    expect(() =>
      parse({ ...loadFixture('user_prompt_submit'), session_id: '' as unknown as string }, baseCtx),
    ).toThrow(ParseError);
    // UserPromptSubmit needs turn_id in ctx
    try {
      parse(loadFixture('user_prompt_submit'), { ...baseCtx, turn_idx: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).field).toBe('turn_id');
    }
  });
});
