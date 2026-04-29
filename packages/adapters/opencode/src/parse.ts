// OpenCode hook envelope → minspect Event reducer.
//
// Shape of the contract:
//   input:  (envelope, priorState) where envelope is what the plugin script
//           pushed via `minspect capture-opencode` stdin, and priorState was
//           read from <state_dir>/sessions/<session_id>.json by the CLI.
//   output: { events, next } — events to POST, state to persist for the next
//           envelope in this session.
//
// The reducer itself is pure; no global state, no I/O. That keeps it easy to
// unit-test with synthetic fixtures and lets the CLI own disk persistence.
//
// Event mapping (cross-checked against @opencode-ai/plugin@1.2.27 +
// @opencode-ai/sdk — see card 38 ground-truth block):
//
//   SDK event.type                              → minspect Event
//   ─────────────────────────────────────────── ─────────────────────────────
//   session.created                             → session_start
//   message.updated (role=user)                 → turn_start
//   message.part.updated (reasoning)            → accumulate into state
//   message.part.updated (text, assistant)      → accumulate into state
//   message.part.updated (tool, state=completed)→ tool_call (with file_edits)
//   message.part.updated (tool, state=error)    → tool_call (status=error)
//   message.updated (role=assistant, completed) → turn_end (flush accumulators)
//   session.deleted                             → session_end
//   tool.before hook                            → stash before_content in state
//   tool.after  hook                            → stash output if no ToolPart
//                                                 arrived first
//   everything else                             → skip, return []

import type { Event, FileEdit, GitState, ToolCallStatus } from '@minspect/core';
import {
  OpenCodeEnvelopeSchema,
  type OpenCodeParserState,
  SdkEventSchema,
  ToolAfterPayloadSchema,
  ToolBeforePayloadSchema,
  emptyOpenCodeState,
} from './types.js';

export interface ParseOptions {
  agent_version?: string;
}

export interface ParseResult {
  events: Event[];
  next: OpenCodeParserState;
  warnings: string[];
}

const DEFAULT_GIT: GitState = { branch: '', head: '', dirty: false };

export function parseOpenCodeEnvelope(
  raw: unknown,
  prior: OpenCodeParserState = emptyOpenCodeState(),
  options: ParseOptions = {},
): ParseResult {
  const env = OpenCodeEnvelopeSchema.safeParse(raw);
  if (!env.success) {
    return {
      events: [],
      next: prior,
      warnings: [`skip:invalid_envelope:${env.error.issues[0]?.message ?? 'unknown'}`],
    };
  }
  const state: OpenCodeParserState = cloneState(prior);
  const events: Event[] = [];
  const warnings: string[] = [];
  const git = env.data.git ?? DEFAULT_GIT;

  switch (env.data.hookName) {
    case 'event':
      handleEvent(env.data.payload, env.data.timestamp, git, state, events, warnings, options);
      break;
    case 'tool.before':
      handleToolBefore(env.data.payload, env.data.timestamp, state, warnings);
      break;
    case 'tool.after':
      handleToolAfter(env.data.payload, env.data.timestamp, state, events, warnings);
      break;
  }

  return { events, next: state, warnings };
}

// --- handlers ---

function handleEvent(
  payload: unknown,
  ts: number,
  git: GitState,
  state: OpenCodeParserState,
  out: Event[],
  warnings: string[],
  options: ParseOptions,
): void {
  const parsed = SdkEventSchema.safeParse(payload);
  if (!parsed.success) {
    warnings.push(`skip:invalid_event:${parsed.error.issues[0]?.message ?? 'unknown'}`);
    return;
  }
  // The SDK union falls back to a passthrough variant for unknown event
  // types. Use the parsed-payload cast rather than TS narrowing because the
  // union includes a passthrough arm that erases the literal `type` field.
  const ev = parsed.data as { type: string; properties?: Record<string, unknown> };
  switch (ev.type) {
    case 'session.created':
      onSessionCreated(ev.properties as never, ts, git, state, out, options);
      return;
    case 'message.updated':
      onMessageUpdated(ev.properties as never, ts, git, state, out);
      return;
    case 'message.part.updated':
      onMessagePartUpdated(ev.properties as never, ts, state, out);
      return;
    case 'session.idle':
      onSessionIdle(ev.properties as never, ts, state, out);
      return;
    case 'session.deleted':
      onSessionDeleted(ev.properties as never, ts, state, out);
      return;
    default:
      // file.edited etc — no direct Event mapping (yet).
      return;
  }
}

function onSessionCreated(
  props: { info: { id: string; directory: string; time?: { created?: number } } },
  ts: number,
  git: GitState,
  state: OpenCodeParserState,
  out: Event[],
  options: ParseOptions,
): void {
  const info = props.info;
  state.session_id = info.id;
  state.workspace = info.directory;
  const agentVersion = options.agent_version;
  const session: Event = {
    type: 'session_start',
    session_id: info.id,
    agent: 'opencode',
    workspace: info.directory,
    git,
    timestamp: info.time?.created ?? ts,
    ...(agentVersion !== undefined ? { agent_version: agentVersion } : {}),
  };
  out.push(session);
}

function onMessageUpdated(
  props: {
    info: {
      id: string;
      sessionID: string;
      role: 'user' | 'assistant';
      time: { created: number; completed?: number };
    };
  },
  ts: number,
  git: GitState,
  state: OpenCodeParserState,
  out: Event[],
): void {
  const info = props.info;
  if (!state.session_id) state.session_id = info.sessionID;

  // User: OpenCode fires `message.updated (role=user)` multiple times for the
  // same message as OpenCode enriches its state. We dedupe by checking
  // whether we've already buffered this user turn id. The real turn_start is
  // emitted LATER by the TextPart handler (so user_prompt can be non-empty);
  // we only record the intent here.
  if (info.role === 'user') {
    if (state.current_turn_id === info.id) return; // already buffered — skip
    // If the previous turn never saw a `session.idle` (e.g. user fired a new
    // message mid-flight), flush its turn_end now so nothing is stranded.
    if (state.current_turn_id && state.last_emitted_turn_end_for !== state.current_turn_id) {
      onSessionIdle({ sessionID: info.sessionID }, ts, state, out);
    }
    state.current_turn_id = info.id;
    state.current_assistant_message_id = undefined;
    state.tool_idx_in_turn = 0;
    state.reasoning_by_part_id = {};
    state.text_by_part_id = {};
    state.pending_reasoning = '';
    state.pending_final_message = '';
    state.pending_turn_start = {
      session_id: info.sessionID,
      turn_id: info.id,
      idx: state.turn_idx,
      timestamp: info.time.created ?? ts,
      git,
    };
    state.turn_idx += 1;
    return;
  }

  // Assistant: just track the current assistant message id (used to
  // distinguish text parts). Do NOT emit turn_end here — a single user turn
  // in OpenCode can span multiple assistant messages (plan → tool → review →
  // final reply) and each fires message.updated(assistant, completed). We
  // emit turn_end only on `session.idle`, which signals the agent is done
  // for real and waiting for the next user input.
  if (info.role === 'assistant') {
    state.current_assistant_message_id = info.id;
  }
}

// Called on `session.idle`. Flushes the accumulated turn (reasoning parts
// joined, final text parts joined) as a single turn_end.
function onSessionIdle(
  props: { sessionID: string },
  ts: number,
  state: OpenCodeParserState,
  out: Event[],
): void {
  if (!state.current_turn_id) return;
  if (state.last_emitted_turn_end_for === state.current_turn_id) return;
  if (state.pending_turn_start) emitPendingTurnStart(state, out, '');

  // Rebuild flattened views from the part-id maps for consistency.
  state.pending_reasoning = Object.values(state.reasoning_by_part_id).filter(Boolean).join('\n\n');
  state.pending_final_message = Object.values(state.text_by_part_id).filter(Boolean).join('\n\n');

  out.push({
    type: 'turn_end',
    turn_id: state.current_turn_id,
    ...(state.pending_reasoning ? { agent_reasoning: state.pending_reasoning } : {}),
    ...(state.pending_final_message ? { agent_final_message: state.pending_final_message } : {}),
    timestamp: ts,
  });
  state.last_emitted_turn_end_for = state.current_turn_id;
  void props;
}

// Helper: flush a buffered user turn_start with the given prompt text.
function emitPendingTurnStart(state: OpenCodeParserState, out: Event[], userPrompt: string): void {
  const p = state.pending_turn_start;
  if (!p) return;
  out.push({
    type: 'turn_start',
    session_id: p.session_id,
    turn_id: p.turn_id,
    idx: p.idx,
    user_prompt: userPrompt,
    git: p.git,
    timestamp: p.timestamp,
  });
  state.pending_turn_start = undefined;
}

function onMessagePartUpdated(
  props: { part: { type: string; [k: string]: unknown } },
  ts: number,
  state: OpenCodeParserState,
  out: Event[],
): void {
  const part = props.part;

  if (part.type === 'reasoning') {
    const text = typeof part.text === 'string' ? part.text : '';
    const partId = typeof part.id === 'string' ? part.id : '';
    if (!partId || !text) return;
    // Store per-part — multiple assistant messages in one turn each have
    // their own ReasoningPart, and we want to join them all at turn_end.
    state.reasoning_by_part_id[partId] = text;
    return;
  }

  if (part.type === 'text') {
    // TextPart belongs to either a user or assistant message. Disambiguate
    // by comparing messageID against the current user turn id — user
    // TextParts flush the buffered turn_start with the prompt text; anything
    // else is treated as the assistant's final message.
    const text = typeof part.text === 'string' ? part.text : '';
    const partId = typeof part.id === 'string' ? part.id : '';
    const messageID = typeof part.messageID === 'string' ? part.messageID : undefined;
    if (!text) return;

    if (messageID && messageID === state.current_turn_id) {
      if (state.pending_turn_start) emitPendingTurnStart(state, out, text);
      return;
    }
    // Assistant text — accumulated by part id so multi-step responses don't
    // clobber each other.
    if (partId) state.text_by_part_id[partId] = text;
    return;
  }

  if (part.type === 'tool') {
    const callID = typeof part.callID === 'string' ? part.callID : '';
    const toolName = typeof part.tool === 'string' ? part.tool : '';
    const stateField = (part.state ?? {}) as Record<string, unknown>;
    const status = typeof stateField.status === 'string' ? stateField.status : '';
    if (status !== 'completed' && status !== 'error') return; // running/pending → wait
    if (!callID || !toolName || !state.current_turn_id || !state.session_id) return;
    if (state.emitted_tool_call_ids.includes(callID)) return;

    // Tool can execute before the user's TextPart has arrived to flush the
    // buffered turn_start. Ensure the parent turn row exists first so the
    // tool_call isn't orphaned.
    if (state.pending_turn_start) {
      emitPendingTurnStart(state, out, '');
    }

    const input = (stateField.input ?? {}) as Record<string, unknown>;
    const output = typeof stateField.output === 'string' ? stateField.output : null;
    const time = (stateField.time ?? {}) as { start?: number; end?: number };
    const startedAt = typeof time.start === 'number' ? time.start : ts;
    const endedAt = typeof time.end === 'number' ? time.end : ts;
    const toolStatus: ToolCallStatus = status === 'error' ? 'error' : 'ok';
    const fileEdits = extractFileEdits(toolName, input, state.before_content_by_call[callID]);

    out.push({
      type: 'tool_call',
      session_id: state.session_id,
      turn_id: state.current_turn_id,
      tool_call_id: callID,
      idx: state.tool_idx_in_turn,
      tool_name: toolName,
      input,
      ...(output !== null ? { output } : {}),
      status: toolStatus,
      ...(fileEdits.length > 0 ? { file_edits: fileEdits } : {}),
      started_at: startedAt,
      ended_at: endedAt,
    });
    state.tool_idx_in_turn += 1;
    state.emitted_tool_call_ids.push(callID);
    // Release the before-content buffer for this call.
    delete state.before_content_by_call[callID];
    return;
  }

  // Unknown part type — skip.
}

function onSessionDeleted(
  props: { sessionID: string },
  ts: number,
  state: OpenCodeParserState,
  out: Event[],
): void {
  out.push({ type: 'session_end', session_id: props.sessionID, timestamp: ts });
  // Leave state in place — caller may choose to delete the file separately.
  void state;
}

function handleToolBefore(
  payload: unknown,
  timestamp: number,
  state: OpenCodeParserState,
  warnings: string[],
): void {
  const parsed = ToolBeforePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    warnings.push('skip:invalid_tool_before');
    return;
  }
  // The plugin-side wrapper should read the current file content from disk
  // before the tool runs and include it as `args._minspect_before_content`.
  // Here we just accept whatever the plugin gave us (string or null). We also
  // stash the envelope timestamp so tool.after can use it as started_at.
  const args = parsed.data.args ?? {};
  const pre = (args as { _minspect_before_content?: unknown })._minspect_before_content;
  state.before_content_by_call[parsed.data.callID] =
    typeof pre === 'string' ? pre : pre === null ? null : null;
  state.tool_started_at_by_call[parsed.data.callID] = timestamp;
}

// Primary tool_call emission path. OpenCode does fire `tool.execute.after` as
// the terminal signal for each tool run (confirmed via real-session logs) —
// message.part.updated for ToolPart completion is unreliable across SDK
// versions, so we don't depend on it.
function handleToolAfter(
  payload: unknown,
  timestamp: number,
  state: OpenCodeParserState,
  out: Event[],
  warnings: string[],
): void {
  const parsed = ToolAfterPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    warnings.push('skip:invalid_tool_after');
    return;
  }
  const p = parsed.data;
  if (!state.current_turn_id || !state.session_id) return;
  if (state.emitted_tool_call_ids.includes(p.callID)) return;

  // Flush pending turn_start so tool_call has a parent turn row.
  if (state.pending_turn_start) emitPendingTurnStart(state, out, '');

  const args = p.args ?? {};
  const outputText = p.output?.output ?? null;
  const beforeContent = state.before_content_by_call[p.callID] ?? null;
  const fileEdits = extractFileEdits(p.tool, args, beforeContent);
  const startedAt = state.tool_started_at_by_call[p.callID] ?? timestamp;

  out.push({
    type: 'tool_call',
    session_id: state.session_id,
    turn_id: state.current_turn_id,
    tool_call_id: p.callID,
    idx: state.tool_idx_in_turn,
    tool_name: p.tool,
    input: args,
    ...(outputText !== null ? { output: outputText } : {}),
    status: 'ok',
    ...(fileEdits.length > 0 ? { file_edits: fileEdits } : {}),
    started_at: startedAt,
    ended_at: timestamp,
  });
  state.tool_idx_in_turn += 1;
  state.emitted_tool_call_ids.push(p.callID);
  delete state.before_content_by_call[p.callID];
  delete state.tool_started_at_by_call[p.callID];
}

// Pull a string arg from the input under any of the given keys. OpenCode's
// built-in tools use camelCase arg names (`filePath`, `oldString`,
// `newString`); we also accept snake_case as a safety net for third-party
// or custom tools that might follow a different convention.
function pickString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

// Only OpenCode's `write` and `edit` built-in tools produce file edits in a
// shape minspect can record. For `edit` we only have the diff slice — the
// before_content we need came from the `tool.before` hook's disk read.
//
// OpenCode built-in tool names follow the pattern `write` / `edit` / `bash` /
// `read` / `glob` / `grep`. Non-edit tools return [].
function extractFileEdits(
  toolName: string,
  input: Record<string, unknown>,
  beforeContent: string | null | undefined,
): FileEdit[] {
  const file = pickString(input, ['filePath', 'file_path', 'path']);
  if (!file) return [];

  if (toolName === 'write') {
    const content = pickString(input, ['content']) ?? '';
    return [
      {
        file_path: file,
        // `write` replaces the file wholesale. If we captured the prior
        // content in tool.before we keep it; otherwise the file is new.
        before_content: beforeContent ?? null,
        after_content: content,
      },
    ];
  }

  if (toolName === 'edit') {
    // OpenCode `edit`'s input is `{filePath, oldString, newString}`. We
    // don't have the full after_content without another disk read, and we
    // don't have the full before_content without tool.before. If the plugin
    // gave us both snapshots (_minspect_before_content on before hook,
    // _minspect_after_content on the after hook), use them; otherwise fall
    // back to synthesising from the string replacement.
    const beforeFromHook = beforeContent;
    const afterRaw = input._minspect_after_content;
    const afterFromHook = typeof afterRaw === 'string' ? afterRaw : undefined;
    if (beforeFromHook != null && afterFromHook != null) {
      return [
        {
          file_path: file,
          before_content: beforeFromHook,
          after_content: afterFromHook,
        },
      ];
    }
    const old = pickString(input, ['oldString', 'old_string']) ?? '';
    const nw = pickString(input, ['newString', 'new_string']) ?? '';
    if (beforeFromHook != null && old && nw != null) {
      // Synthesise after_content by doing the first-occurrence replace that
      // OpenCode itself would do.
      const idx = beforeFromHook.indexOf(old);
      if (idx >= 0) {
        const after = beforeFromHook.slice(0, idx) + nw + beforeFromHook.slice(idx + old.length);
        return [
          {
            file_path: file,
            before_content: beforeFromHook,
            after_content: after,
          },
        ];
      }
    }
    // Not enough info to record a safe edit.
    return [];
  }

  return [];
}

function cloneState(s: OpenCodeParserState): OpenCodeParserState {
  return {
    ...s,
    pending_reasoning: s.pending_reasoning,
    pending_final_message: s.pending_final_message,
    reasoning_by_part_id: { ...s.reasoning_by_part_id },
    text_by_part_id: { ...s.text_by_part_id },
    before_content_by_call: { ...s.before_content_by_call },
    tool_started_at_by_call: { ...s.tool_started_at_by_call },
    emitted_tool_call_ids: [...s.emitted_tool_call_ids],
  };
}

// Re-export types the CLI may need.
export { emptyOpenCodeState } from './types.js';
export type { OpenCodeParserState } from './types.js';
