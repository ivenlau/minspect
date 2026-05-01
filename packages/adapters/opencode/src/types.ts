// Runtime zod schemas for the subset of @opencode-ai/plugin / @opencode-ai/sdk
// types we care about. Kept deliberately permissive (most fields optional) so
// minor SDK drift between versions doesn't reject envelopes — we prefer
// silently dropping unrecognised shapes over throwing on the hook path.
//
// Reference cross-checked against @opencode-ai/plugin@1.2.27 installed under
// ~/.config/opencode/node_modules/ — see card 38 ground-truth block.

import { z } from 'zod';

// --- Hook envelope (what the plugin pushes to `minspect capture-opencode`) ---

// Three envelope flavors:
//   hookName='event'       → payload = SDK Event (session.*, message.*, file.*)
//   hookName='tool.before' → payload = { tool, sessionID, callID, args }
//   hookName='tool.after'  → payload = { tool, sessionID, callID, args, output }

export const OpenCodeEnvelopeSchema = z.object({
  hookName: z.enum(['event', 'tool.before', 'tool.after']),
  payload: z.unknown(),
  timestamp: z.number().int().nonnegative(),
  // Optional git state captured at plugin side if available (plugin has $
  // Bun shell to read git HEAD/branch).
  git: z
    .object({
      branch: z.string(),
      head: z.string(),
      dirty: z.boolean(),
    })
    .optional(),
});

export type OpenCodeEnvelope = z.infer<typeof OpenCodeEnvelopeSchema>;

// --- SDK Event type (partial; only the variants we care about) ---

// session.created carries the full Session object with its working directory.
export const SdkSessionCreatedSchema = z.object({
  type: z.literal('session.created'),
  properties: z.object({
    info: z.object({
      id: z.string(),
      directory: z.string(),
      time: z
        .object({
          created: z.number().optional(),
        })
        .optional(),
    }),
  }),
});

export const SdkSessionIdleSchema = z.object({
  type: z.literal('session.idle'),
  properties: z.object({ sessionID: z.string() }),
});

export const SdkSessionDeletedSchema = z.object({
  type: z.literal('session.deleted'),
  properties: z.object({ sessionID: z.string() }),
});

// message.updated wraps a UserMessage or AssistantMessage. We discriminate by
// `info.role` and for assistants use `info.time.completed` as the "done" signal.
export const SdkUserMessageSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.literal('user'),
  time: z.object({ created: z.number() }),
});

export const SdkAssistantMessageSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.literal('assistant'),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
});

export const SdkMessageUpdatedSchema = z.object({
  type: z.literal('message.updated'),
  properties: z.object({
    info: z.union([SdkUserMessageSchema, SdkAssistantMessageSchema]),
  }),
});

// message.part.updated — the workhorse. Tool, reasoning and final-text parts
// all flow through here.
export const SdkTextPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('text'),
  text: z.string(),
  time: z
    .object({
      start: z.number(),
      end: z.number().optional(),
    })
    .optional(),
});

export const SdkReasoningPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('reasoning'),
  text: z.string(),
  time: z.object({
    start: z.number(),
    end: z.number().optional(),
  }),
});

export const SdkToolStateCompletedSchema = z.object({
  status: z.literal('completed'),
  input: z.record(z.unknown()),
  output: z.string(),
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  time: z.object({
    start: z.number(),
    end: z.number(),
  }),
});

export const SdkToolStateErrorSchema = z.object({
  status: z.literal('error'),
  input: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  time: z
    .object({
      start: z.number(),
      end: z.number().optional(),
    })
    .optional(),
});

// Only "completed" and "error" actually produce a tool_call. Running / pending
// parts are incremental updates that get overwritten.
export const SdkToolPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('tool'),
  callID: z.string(),
  tool: z.string(),
  state: z.union([
    SdkToolStateCompletedSchema,
    SdkToolStateErrorSchema,
    // Ignore running / pending states — we produce tool_call once terminal.
    z
      .object({ status: z.string() })
      .passthrough(),
  ]),
});

export const SdkMessagePartUpdatedSchema = z.object({
  type: z.literal('message.part.updated'),
  properties: z.object({
    part: z.union([
      SdkTextPartSchema,
      SdkReasoningPartSchema,
      SdkToolPartSchema,
      // Fall-through: unknown part types (subtask, step-start, file, ...)
      z
        .object({ type: z.string() })
        .passthrough(),
    ]),
  }),
});

export const SdkFileEditedSchema = z.object({
  type: z.literal('file.edited'),
  properties: z.object({ file: z.string() }),
});

// Anything else from the Event union — we accept the envelope but skip.
// Keep this union closed for the variants we actively handle and passthrough
// the rest.
export const SdkEventSchema = z.union([
  SdkSessionCreatedSchema,
  SdkSessionIdleSchema,
  SdkSessionDeletedSchema,
  SdkMessageUpdatedSchema,
  SdkMessagePartUpdatedSchema,
  SdkFileEditedSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export type SdkEvent = z.infer<typeof SdkEventSchema>;

// --- tool.execute.before / after payloads ---

export const ToolBeforePayloadSchema = z.object({
  tool: z.string(),
  sessionID: z.string(),
  callID: z.string(),
  args: z.record(z.unknown()).optional(),
});

export const ToolAfterPayloadSchema = z.object({
  tool: z.string(),
  sessionID: z.string(),
  callID: z.string(),
  args: z.record(z.unknown()).optional(),
  output: z
    .object({
      title: z.string().optional(),
      output: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

// --- Parser state (persisted per session between envelope calls) ---

// The CLI writes this JSON to <state_dir>/sessions/<session_id>.json under a
// dedicated `opencode` subkey so it can co-exist with the Claude-Code state
// fields.
export interface OpenCodeParserState {
  session_id?: string;
  workspace?: string;
  turn_idx: number;
  current_turn_id?: string;
  current_assistant_message_id?: string;
  tool_idx_in_turn: number;
  // Per-turn accumulated text for turn_end flush. One user message in
  // OpenCode may be followed by multiple assistant messages (plan → tool →
  // review → final reply) — each emits its own ReasoningPart / TextPart
  // with distinct part.id. We store by id and join on flush so nothing is
  // clobbered by the last-write-wins of a single part.
  reasoning_by_part_id: Record<string, string>;
  text_by_part_id: Record<string, string>;
  // Legacy flattened views — rebuilt from the maps above on each update for
  // debuggability when inspecting the JSON state file by hand.
  pending_reasoning: string;
  pending_final_message: string;
  // Buffered user turn_start: we hold emission until the user TextPart
  // arrives so `user_prompt` is populated rather than ''.
  pending_turn_start?: {
    session_id: string;
    turn_id: string;
    idx: number;
    timestamp: number;
    git: { branch: string; head: string; dirty: boolean };
  };
  // User text buffered from a TextPart that arrived before or after its
  // parent turn_start was flushed. Applied on the next emitPendingTurnStart
  // or onSessionIdle so the prompt isn't lost.
  pending_user_text?: string;
  // turn_id for which we've already emitted a turn_end — prevents multiple
  // turn_end events on repeated `message.updated (role=assistant, completed)`.
  last_emitted_turn_end_for?: string;
  // Captured by `tool.execute.before`: file_path → snapshot at before-time.
  // Keyed by the tool callID so the matching `after` or ToolPart can pull it.
  before_content_by_call: Record<string, string | null>;
  // Envelope timestamp captured by `tool.execute.before` — used as
  // started_at on the emitted tool_call when `tool.execute.after` fires.
  tool_started_at_by_call: Record<string, number>;
  // callIDs we've already emitted tool_call for (dedup against both the
  // ToolPart "completed" event and a later tool.after hook with the same
  // callID).
  emitted_tool_call_ids: string[];
}

export function emptyOpenCodeState(): OpenCodeParserState {
  return {
    turn_idx: 0,
    tool_idx_in_turn: 0,
    reasoning_by_part_id: {},
    text_by_part_id: {},
    pending_reasoning: '',
    pending_final_message: '',
    before_content_by_call: {},
    tool_started_at_by_call: {},
    emitted_tool_call_ids: [],
  };
}
