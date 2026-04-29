import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractReasoning } from './reasoning.js';

describe('extractReasoning', () => {
  let dir: string;
  let transcriptPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'minspect-reasoning-'));
    transcriptPath = join(dir, 'transcript.jsonl');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts thinking + text from last assistant message', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'hi' }),
      JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Considering options...' },
          { type: 'text', text: 'Here is the plan.' },
        ],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.agent_reasoning).toBe('Considering options...');
    expect(r.agent_final_message).toBe('Here is the plan.');
  });

  it('picks the last assistant message when multiple exist', () => {
    const lines = [
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'first' }],
      }),
      JSON.stringify({ role: 'user', content: 'more?' }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'second' }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.agent_final_message).toBe('second');
  });

  it('supports nested message.content wrapper shape', () => {
    const lines = [
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'wrapped' }],
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    expect(extractReasoning(transcriptPath).agent_final_message).toBe('wrapped');
  });

  it('returns empty tool_explanations when file is missing (no throw)', () => {
    const r = extractReasoning('/nonexistent/path');
    expect(r.tool_explanations).toEqual([]);
    expect(r.agent_reasoning).toBeUndefined();
    expect(r.agent_final_message).toBeUndefined();
  });

  it('skips malformed JSON lines and continues', () => {
    const lines = [
      'not json',
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'survived' }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    expect(extractReasoning(transcriptPath).agent_final_message).toBe('survived');
  });

  it('returns empty fields when no assistant messages in transcript', () => {
    writeFileSync(transcriptPath, JSON.stringify({ role: 'user', content: 'only user' }));
    const r = extractReasoning(transcriptPath);
    expect(r.agent_reasoning).toBeUndefined();
    expect(r.agent_final_message).toBeUndefined();
    expect(r.tool_explanations).toEqual([]);
  });

  it('attaches preamble text from preceding assistant msg to following tool_use', () => {
    // Realistic Claude Code pattern: text msg (stop_reason:tool_use) → tool_use msg
    const lines = [
      JSON.stringify({ role: 'user', content: 'edit foo' }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: "I'll edit foo.ts to add logging." }],
      }),
      JSON.stringify({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'Edit',
            input: { file_path: '/foo.ts', old_string: 'a', new_string: 'b' },
          },
        ],
      }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.tool_explanations).toHaveLength(1);
    expect(r.tool_explanations[0]?.tool_name).toBe('Edit');
    expect(r.tool_explanations[0]?.preamble_text).toBe("I'll edit foo.ts to add logging.");
    expect(r.agent_final_message).toBe('Done.');
  });

  it('one preamble covers multiple consecutive tool_uses in one assistant msg', () => {
    const lines = [
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me edit three files in one shot.' }],
      }),
      JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a.ts' } },
          { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/b.ts' } },
          { type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/c.ts' } },
        ],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.tool_explanations).toHaveLength(3);
    expect(
      r.tool_explanations.every((e) => e.preamble_text === 'Let me edit three files in one shot.'),
    ).toBe(true);
  });

  it('preamble_thinking is captured when present, empty text is fine', () => {
    const lines = [
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'user probably wants X' }],
      }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'Write', input: { file_path: '/x' } }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.tool_explanations).toHaveLength(1);
    expect(r.tool_explanations[0]?.preamble_thinking).toBe('user probably wants X');
    expect(r.tool_explanations[0]?.preamble_text).toBeUndefined();
  });

  it('tool_use without a preceding preamble gets undefined preamble fields', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'do it' }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'Edit', input: { file_path: '/a' } }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.tool_explanations).toHaveLength(1);
    expect(r.tool_explanations[0]?.preamble_text).toBeUndefined();
    expect(r.tool_explanations[0]?.preamble_thinking).toBeUndefined();
  });

  it('preamble resets after being consumed (does not leak to later tool_use)', () => {
    const lines = [
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'preamble 1' }],
      }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a' } }],
      }),
      JSON.stringify({ role: 'user', content: { type: 'tool_result' } }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/b' } }],
      }),
    ];
    writeFileSync(transcriptPath, lines.join('\n'));
    const r = extractReasoning(transcriptPath);
    expect(r.tool_explanations).toHaveLength(2);
    expect(r.tool_explanations[0]?.preamble_text).toBe('preamble 1');
    expect(r.tool_explanations[1]?.preamble_text).toBeUndefined();
  });
});
