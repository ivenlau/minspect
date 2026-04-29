import type { ReviewEdit, ReviewTurn } from './types';

export interface ReplayStep {
  turn: ReviewTurn;
  // Undefined for turns with no tool calls (empty turn → a single placeholder step).
  tool_call_id?: string;
  tool_name?: string | null;
  explanation?: string | null;
  edits: ReviewEdit[];
  empty: boolean;
}

// Flatten a session into one step per tool_call, preserving turn boundaries.
// Turns with no tool_calls produce a single "empty" step so they aren't
// silently skipped. Within a turn, edits are grouped by `tool_call_id`
// (MultiEdit produces multiple file_edits under the same tool_call).
export function flattenReplaySteps(turns: ReviewTurn[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  for (const t of turns) {
    const order: string[] = [];
    const byTc = new Map<string, ReviewEdit[]>();
    for (const e of t.edits) {
      const key = e.tool_call_id ?? `__anon_${order.length}__`;
      let bucket = byTc.get(key);
      if (!bucket) {
        bucket = [];
        byTc.set(key, bucket);
        order.push(key);
      }
      bucket.push(e);
    }
    if (order.length === 0) {
      steps.push({ turn: t, edits: [], empty: true });
    } else {
      for (const key of order) {
        const group = byTc.get(key) ?? [];
        const first = group[0];
        steps.push({
          turn: t,
          tool_call_id: first?.tool_call_id ?? undefined,
          tool_name: first?.tool_name ?? null,
          explanation: first?.tool_call_explanation ?? null,
          edits: group,
          empty: false,
        });
      }
    }
  }
  return steps;
}
