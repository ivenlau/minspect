// Parses a Codex CLI rollout-*.jsonl session log into minspect Events.
//
// Log envelope: each line is `{timestamp, type, payload}`.
//
// Observed record types (codex CLI 0.104 / 0.105):
//   session_meta                     → session_start
//   event_msg:task_started           → turn_start  (turn_id)
//   event_msg:user_message           → user_prompt for the pending turn_start
//   event_msg:agent_reasoning        → accumulated → turn_end.agent_reasoning
//   event_msg:agent_message          → accumulated → turn_end.agent_final_message
//   event_msg:task_complete          → emit turn_end
//   event_msg:turn_aborted           → emit turn_end (no final message)
//   event_msg:token_count / error / *_end / * → skip (noise or redundant)
//   turn_context                     → skip (already captured by session_meta)
//   response_item:message (any role) → skip (dup of event_msg:user_message /
//                                             event_msg:agent_message)
//   response_item:reasoning          → skip (encrypted)
//   response_item:function_call      → pending tool_call (join by call_id)
//   response_item:function_call_output → resolve tool_call, emit
//   response_item:custom_tool_call   → pending tool_call (apply_patch / update_plan)
//   response_item:custom_tool_call_output → resolve, emit
//   response_item:web_search_call    → emit standalone tool_call (no output)

import type { Event, FileEdit, GitState, ToolCallStatus } from '@minspect/core';
import { parseApplyPatch, toFileEdits } from './patch.js';

export interface ParseOptions {
  // Agent version to tag sessions with (defaults to cli_version from meta).
  agent_version?: string;
}

interface PendingTool {
  call_id: string;
  name: string;
  arguments: unknown;
  started_at: number;
  idx: number;
}

interface PendingTurn {
  turn_id: string;
  idx: number;
  started_at: number;
  user_prompt: string;
  reasoning: string[];
  final_message: string[];
  tool_idx: number;
}

function parseTimestamp(s: string | number | undefined): number {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

function safeJsonParse(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function statusFromOutput(output: unknown): ToolCallStatus {
  if (output == null) return 'ok';
  if (typeof output === 'string') {
    if (/^Error|Exit code:\s*[1-9]/m.test(output)) return 'error';
    return 'ok';
  }
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>;
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.exit_code === 'number' && meta.exit_code !== 0) return 'error';
    if (o.error) return 'error';
  }
  return 'ok';
}

// --- Parser ---

export interface ParseCodexLogResult {
  events: Event[];
  warnings: string[];
  session_id?: string;
  workspace?: string;
  agent_version?: string;
}

export function parseCodexLog(content: string, options: ParseOptions = {}): ParseCodexLogResult {
  const warnings: string[] = [];
  const events: Event[] = [];
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  let session_id: string | undefined;
  let workspace: string | undefined;
  let agent_version: string | undefined;
  let session_started_at = 0;

  // Pending turn (one at a time; Codex is sequential). Declared as the wider
  // type up front so closures below narrow correctly when we assign a new
  // PendingTurn after flushing a prior one.
  const turnState: { current: PendingTurn | null } = { current: null };
  let turnCounter = 0;

  // Pending tool calls keyed by call_id — resolved when the matching
  // *_output arrives.
  const pendingTools = new Map<string, PendingTool>();

  const git: GitState = { branch: '', head: '', dirty: false };

  let turnStartEmitted = false;

  const emitTurnStart = (t: PendingTurn): void => {
    if (!session_id) return;
    events.push({
      type: 'turn_start',
      session_id,
      turn_id: t.turn_id,
      idx: t.idx,
      user_prompt: t.user_prompt,
      git,
      timestamp: t.started_at,
    });
  };

  const emitTurnEnd = (ts: number, final: boolean): void => {
    const t = turnState.current;
    if (!t) return;
    if (!turnStartEmitted) {
      emitTurnStart(t);
      turnStartEmitted = true;
    }
    events.push({
      type: 'turn_end',
      turn_id: t.turn_id,
      agent_reasoning: t.reasoning.length > 0 ? t.reasoning.join('\n\n') : undefined,
      agent_final_message: t.final_message.length > 0 ? t.final_message.join('\n\n') : undefined,
      timestamp: ts,
    });
    turnState.current = null;
    turnStartEmitted = false;
    if (!final && pendingTools.size > 0) pendingTools.clear();
  };

  const startTurn = (turn_id: string, ts: number): void => {
    if (turnState.current) emitTurnEnd(ts, false);
    turnState.current = {
      turn_id,
      idx: turnCounter++,
      started_at: ts,
      user_prompt: '',
      reasoning: [],
      final_message: [],
      tool_idx: 0,
    };
  };

  const ensureTurnStartEmitted = (): void => {
    const t = turnState.current;
    if (t && !turnStartEmitted) {
      emitTurnStart(t);
      turnStartEmitted = true;
    }
  };

  for (const raw of lines) {
    let env: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try {
      env = JSON.parse(raw);
    } catch {
      warnings.push(`skip: invalid JSON line (${raw.slice(0, 60)})`);
      continue;
    }
    const ts = parseTimestamp(env.timestamp);
    const p = env.payload ?? {};

    switch (env.type) {
      case 'session_meta': {
        session_id = p.id as string | undefined;
        workspace = (p.cwd as string | undefined) ?? '';
        agent_version = options.agent_version ?? (p.cli_version as string | undefined);
        session_started_at = parseTimestamp((p.timestamp as string | undefined) ?? env.timestamp);
        if (!session_id || !workspace) {
          warnings.push('session_meta missing id/cwd — session_start suppressed');
          break;
        }
        events.push({
          type: 'session_start',
          session_id,
          agent: 'codex',
          agent_version,
          workspace,
          git,
          timestamp: session_started_at,
        });
        break;
      }
      case 'turn_context':
        break; // already captured in session_meta
      case 'event_msg': {
        switch (p.type) {
          case 'task_started': {
            const turn_id = p.turn_id as string | undefined;
            if (!turn_id) {
              warnings.push('task_started without turn_id — skipped');
              break;
            }
            startTurn(turn_id, ts);
            break;
          }
          case 'user_message': {
            const t = turnState.current;
            if (!t) {
              warnings.push('user_message without active turn — dropped');
              break;
            }
            t.user_prompt = typeof p.message === 'string' ? p.message : '';
            break;
          }
          case 'agent_reasoning': {
            const t = turnState.current;
            if (!t) break;
            const text = typeof p.text === 'string' ? p.text : '';
            if (text) t.reasoning.push(text);
            break;
          }
          case 'agent_message': {
            const t = turnState.current;
            if (!t) break;
            const msg = typeof p.message === 'string' ? p.message : '';
            if (msg) t.final_message.push(msg);
            break;
          }
          case 'task_complete': {
            emitTurnEnd(ts, true);
            break;
          }
          case 'turn_aborted': {
            emitTurnEnd(ts, false);
            break;
          }
          // Noise / redundant:
          case 'token_count':
          case 'error':
          case 'exec_command_end':
          case 'patch_apply_end':
          case 'web_search_end':
          case 'context_compacted':
          case 'entered_review_mode':
          case 'exited_review_mode':
          case 'item_completed':
            break;
          default:
            warnings.push(`skip event_msg:${p.type}`);
        }
        break;
      }
      case 'response_item': {
        switch (p.type) {
          case 'message':
          case 'reasoning':
            break; // dup / encrypted
          case 'function_call':
          case 'custom_tool_call': {
            const t = turnState.current;
            if (!t) break;
            ensureTurnStartEmitted();
            const call_id = (p.call_id as string | undefined) ?? `codex-${ts}-${t.tool_idx}`;
            const name = (p.name as string | undefined) ?? 'unknown';
            const args =
              p.type === 'function_call' ? safeJsonParse(p.arguments) : (p.input as unknown);
            pendingTools.set(call_id, {
              call_id,
              name,
              arguments: args,
              started_at: ts,
              idx: t.tool_idx++,
            });
            break;
          }
          case 'function_call_output':
          case 'custom_tool_call_output': {
            const t = turnState.current;
            if (!t || !session_id) break;
            const call_id = p.call_id as string | undefined;
            const pending = call_id ? pendingTools.get(call_id) : undefined;
            if (!pending || !call_id) {
              warnings.push(`${p.type} without matching call_id ${call_id}`);
              break;
            }
            pendingTools.delete(call_id);
            const outputRaw = p.output as unknown;
            const output =
              p.type === 'custom_tool_call_output' ? safeJsonParse(outputRaw) : outputRaw;
            const status = statusFromOutput(output);
            let file_edits: FileEdit[] | undefined;
            if (pending.name === 'apply_patch' && typeof pending.arguments === 'string') {
              const parsed = parseApplyPatch(pending.arguments);
              if (parsed.length > 0) file_edits = toFileEdits(parsed);
            }
            events.push({
              type: 'tool_call',
              session_id,
              turn_id: t.turn_id,
              tool_call_id: call_id,
              idx: pending.idx,
              tool_name: pending.name,
              input: pending.arguments,
              output,
              status,
              file_edits,
              started_at: pending.started_at,
              ended_at: ts,
            });
            break;
          }
          case 'web_search_call': {
            const t = turnState.current;
            if (!t || !session_id) break;
            ensureTurnStartEmitted();
            const call_id = (p.call_id as string | undefined) ?? `codex-web-${ts}-${t.tool_idx}`;
            events.push({
              type: 'tool_call',
              session_id,
              turn_id: t.turn_id,
              tool_call_id: call_id,
              idx: t.tool_idx++,
              tool_name: 'web_search',
              input: { query: p.query ?? null },
              output: p.results ?? null,
              status: 'ok',
              started_at: ts,
              ended_at: ts,
            });
            break;
          }
          default:
            warnings.push(`skip response_item:${p.type}`);
        }
        break;
      }
      case 'compacted':
        break;
      default:
        warnings.push(`skip top-level type ${env.type}`);
    }
  }

  // Dangling turn (no task_complete at end of file)
  if (turnState.current) {
    emitTurnEnd(session_started_at, false);
  }

  // session_end (optional — emit one using the latest event timestamp).
  if (session_id && events.length > 0) {
    const last = events[events.length - 1];
    let endTs = session_started_at;
    if (last && 'timestamp' in last && typeof last.timestamp === 'number') endTs = last.timestamp;
    else if (last && 'ended_at' in last && typeof last.ended_at === 'number') endTs = last.ended_at;
    events.push({ type: 'session_end', session_id, timestamp: endTs });
  }

  return { events, warnings, session_id, workspace, agent_version };
}
