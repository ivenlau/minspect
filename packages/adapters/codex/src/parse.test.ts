import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolCallEvent } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { parseCodexLog } from './parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseCodexLog — simple synthetic fixture', () => {
  const result = parseCodexLog(readFixture('simple-session.jsonl'));

  it('emits session_start from session_meta', () => {
    const start = result.events.find((e) => e.type === 'session_start');
    expect(start).toBeDefined();
    expect(start && start.type === 'session_start' && start.session_id).toBe(
      '01-test-session-uuid',
    );
    expect(start && start.type === 'session_start' && start.agent).toBe('codex');
    expect(start && start.type === 'session_start' && start.agent_version).toBe('0.104.0');
  });

  it('emits turn_start with user_prompt', () => {
    const starts = result.events.filter((e) => e.type === 'turn_start');
    expect(starts).toHaveLength(2);
    expect(starts[0] && 'user_prompt' in starts[0] && starts[0].user_prompt).toBe('hello');
    expect(starts[1] && 'user_prompt' in starts[1] && starts[1].user_prompt).toBe(
      'rename greeting',
    );
  });

  it('emits turn_end with agent_reasoning and agent_final_message', () => {
    const ends = result.events.filter((e) => e.type === 'turn_end');
    expect(ends).toHaveLength(2);
    expect(ends[0]?.type === 'turn_end' && ends[0].agent_final_message).toBe('Hi there!');
    const t2 = ends[1];
    expect(t2?.type === 'turn_end' && t2.agent_reasoning).toContain('I will edit hello.txt');
    expect(t2?.type === 'turn_end' && t2.agent_final_message).toBe('Done — renamed greeting.');
  });

  it('joins function_call + function_call_output into a tool_call', () => {
    const tools = result.events.filter((e) => e.type === 'tool_call') as ToolCallEvent[];
    const shell = tools.find((t) => t.tool_name === 'shell_command');
    expect(shell).toBeDefined();
    expect(shell?.status).toBe('ok');
    expect(shell && typeof shell.input === 'object' && shell.input).toMatchObject({
      command: 'ls',
    });
  });

  it('parses apply_patch into file_edits', () => {
    const tools = result.events.filter((e) => e.type === 'tool_call') as ToolCallEvent[];
    const patch = tools.find((t) => t.tool_name === 'apply_patch');
    if (!patch) throw new Error('apply_patch tool call missing');
    const edits = patch.file_edits ?? [];
    expect(edits).toHaveLength(1);
    const edit = edits[0];
    if (!edit) throw new Error('no file edit');
    expect(edit.file_path).toBe('hello.txt');
    expect(edit.before_content).toBe('hello');
    expect(edit.after_content).toBe('Hi');
  });

  it('emits session_end last', () => {
    const last = result.events[result.events.length - 1];
    expect(last?.type).toBe('session_end');
  });
});

describe('parseCodexLog — real sanitized fixture', () => {
  const result = parseCodexLog(readFixture('real-short-session.jsonl'));

  it('extracts the session_id from session_meta', () => {
    expect(result.session_id).toBe('019c98ee-b0f8-7000-9ff5-66be134413be');
    expect(result.workspace).toMatch(/ws\\user\\Desktop|ws\/user\/Desktop/);
  });

  it('emits one turn_start and one turn_end', () => {
    const starts = result.events.filter((e) => e.type === 'turn_start');
    const ends = result.events.filter((e) => e.type === 'turn_end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });

  it('captures the user prompt "你好"', () => {
    const starts = result.events.filter((e) => e.type === 'turn_start');
    expect(starts[0] && 'user_prompt' in starts[0] && starts[0].user_prompt).toBe('你好');
  });

  it('produces no parser warnings for unknown record types', () => {
    // All codex CLI record types we saw in the wild should be recognized
    expect(result.warnings.filter((w) => w.startsWith('skip'))).toEqual([]);
  });
});

describe('parseCodexLog — error resilience', () => {
  it('ignores invalid JSON lines but continues', () => {
    const badInput =
      '{"type":"session_meta","timestamp":"2026-04-01T10:00:00Z","payload":{"id":"s","cwd":"/w","cli_version":"0.1"}}\n' +
      '{not json}\n' +
      '{"type":"event_msg","timestamp":"2026-04-01T10:00:01Z","payload":{"type":"task_started","turn_id":"t1"}}\n' +
      '{"type":"event_msg","timestamp":"2026-04-01T10:00:02Z","payload":{"type":"task_complete","turn_id":"t1"}}\n';
    const r = parseCodexLog(badInput);
    expect(r.warnings.some((w) => w.includes('invalid JSON'))).toBe(true);
    expect(r.events.find((e) => e.type === 'session_start')).toBeDefined();
    expect(r.events.find((e) => e.type === 'turn_start')).toBeDefined();
    expect(r.events.find((e) => e.type === 'turn_end')).toBeDefined();
  });

  it('handles a function_call without matching output (warns, no throw)', () => {
    const input =
      '{"type":"session_meta","timestamp":"2026-04-01T10:00:00Z","payload":{"id":"s","cwd":"/w","cli_version":"0.1"}}\n' +
      '{"type":"event_msg","timestamp":"2026-04-01T10:00:01Z","payload":{"type":"task_started","turn_id":"t1"}}\n' +
      '{"type":"response_item","timestamp":"2026-04-01T10:00:02Z","payload":{"type":"function_call","name":"shell","arguments":"{}","call_id":"c1"}}\n' +
      '{"type":"event_msg","timestamp":"2026-04-01T10:00:03Z","payload":{"type":"turn_aborted","turn_id":"t1"}}\n';
    const r = parseCodexLog(input);
    expect(r.events.filter((e) => e.type === 'tool_call')).toHaveLength(0);
    expect(r.events.find((e) => e.type === 'turn_end')).toBeDefined();
  });

  it('is idempotent-safe: same input twice produces same event count', () => {
    const input = readFixture('simple-session.jsonl');
    const r1 = parseCodexLog(input);
    const r2 = parseCodexLog(input);
    expect(r1.events.length).toBe(r2.events.length);
    expect(r1.session_id).toBe(r2.session_id);
  });
});
