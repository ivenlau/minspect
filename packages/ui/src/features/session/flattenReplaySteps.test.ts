import { describe, expect, it } from 'vitest';
import { flattenReplaySteps } from './flattenReplaySteps';
import type { ReviewTurn } from './types';

function turn(id: string, idx: number, edits: ReviewTurn['edits']): ReviewTurn {
  return {
    id,
    idx,
    user_prompt: 'p',
    agent_reasoning: null,
    agent_final_message: null,
    started_at: idx,
    ended_at: idx + 1,
    edits,
    badges: [],
  };
}

function edit(tcId: string, file: string, tool = 'Edit') {
  return {
    id: `${tcId}:${file}`,
    file_path: file,
    before_hash: null,
    after_hash: 'x',
    git_head: null,
    tool_call_id: tcId,
    tool_name: tool,
    tool_call_explanation: `explanation for ${tcId}`,
    hunks: [],
  };
}

describe('flattenReplaySteps', () => {
  it('returns empty array for no turns', () => {
    expect(flattenReplaySteps([])).toEqual([]);
  });

  it('one empty turn → one "empty" step (no silent skip)', () => {
    const steps = flattenReplaySteps([turn('t1', 0, [])]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.empty).toBe(true);
    expect(steps[0]?.edits).toEqual([]);
  });

  it('one turn with two distinct tool_calls → two steps', () => {
    const steps = flattenReplaySteps([turn('t1', 0, [edit('tc1', 'a.ts'), edit('tc2', 'b.ts')])]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.tool_call_id).toBe('tc1');
    expect(steps[1]?.tool_call_id).toBe('tc2');
  });

  it('MultiEdit (same tool_call_id, multiple files) stays one step', () => {
    const steps = flattenReplaySteps([
      turn('t1', 0, [edit('tc1', 'a.ts', 'MultiEdit'), edit('tc1', 'b.ts', 'MultiEdit')]),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.edits).toHaveLength(2);
    expect(steps[0]?.tool_name).toBe('MultiEdit');
  });

  it('preserves turn boundaries and order', () => {
    const steps = flattenReplaySteps([
      turn('t1', 0, [edit('tc1', 'a.ts')]),
      turn('t2', 1, []),
      turn('t3', 2, [edit('tc3', 'c.ts'), edit('tc4', 'd.ts')]),
    ]);
    expect(steps).toHaveLength(4);
    expect(steps[0]?.turn.idx).toBe(0);
    expect(steps[1]?.turn.idx).toBe(1);
    expect(steps[1]?.empty).toBe(true);
    expect(steps[2]?.turn.idx).toBe(2);
    expect(steps[3]?.turn.idx).toBe(2);
  });

  it('explanation is pulled from the first edit of each group', () => {
    const steps = flattenReplaySteps([turn('t1', 0, [edit('tc1', 'a.ts')])]);
    expect(steps[0]?.explanation).toBe('explanation for tc1');
  });
});
