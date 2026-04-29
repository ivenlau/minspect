import { z } from 'zod';

export const GitStateSchema = z.object({
  branch: z.string(),
  head: z.string(),
  dirty: z.boolean(),
});
export type GitState = z.infer<typeof GitStateSchema>;

export const FileEditSchema = z.object({
  file_path: z.string(),
  before_content: z.string().nullable(),
  after_content: z.string(),
});
export type FileEdit = z.infer<typeof FileEditSchema>;

export const ToolCallStatusSchema = z.enum(['ok', 'error', 'denied']);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

export const SessionStartEventSchema = z.object({
  type: z.literal('session_start'),
  session_id: z.string().min(1),
  agent: z.string().min(1),
  agent_version: z.string().optional(),
  workspace: z.string().min(1),
  git: GitStateSchema,
  timestamp: z.number().int().nonnegative(),
});

export const TurnStartEventSchema = z.object({
  type: z.literal('turn_start'),
  session_id: z.string().min(1),
  turn_id: z.string().min(1),
  idx: z.number().int().nonnegative(),
  user_prompt: z.string(),
  git: GitStateSchema,
  timestamp: z.number().int().nonnegative(),
});

export const ToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  session_id: z.string().min(1),
  turn_id: z.string().min(1),
  tool_call_id: z.string().min(1),
  idx: z.number().int().nonnegative(),
  tool_name: z.string().min(1),
  input: z.unknown(),
  output: z.unknown().optional(),
  status: ToolCallStatusSchema,
  file_edits: z.array(FileEditSchema).optional(),
  started_at: z.number().int().nonnegative(),
  ended_at: z.number().int().nonnegative(),
});

export const TurnEndEventSchema = z.object({
  type: z.literal('turn_end'),
  turn_id: z.string().min(1),
  agent_reasoning: z.string().optional(),
  agent_final_message: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});

export const SessionEndEventSchema = z.object({
  type: z.literal('session_end'),
  session_id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
});

// Emitted by the CLI at Stop, once per tool_use extracted from the transcript.
// The collector matches it back to the tool_call row by (turn_id, tool_name,
// input content) and populates `tool_calls.explanation`.
export const ToolCallExplanationEventSchema = z.object({
  type: z.literal('tool_call_explanation'),
  turn_id: z.string().min(1),
  tool_name: z.string().min(1),
  input: z.unknown(),
  explanation: z.string(),
  timestamp: z.number().int().nonnegative(),
});

export const EventSchema = z.discriminatedUnion('type', [
  SessionStartEventSchema,
  TurnStartEventSchema,
  ToolCallEventSchema,
  TurnEndEventSchema,
  SessionEndEventSchema,
  ToolCallExplanationEventSchema,
]);
export type Event = z.infer<typeof EventSchema>;

export type SessionStartEvent = z.infer<typeof SessionStartEventSchema>;
export type TurnStartEvent = z.infer<typeof TurnStartEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;
export type SessionEndEvent = z.infer<typeof SessionEndEventSchema>;
export type ToolCallExplanationEvent = z.infer<typeof ToolCallExplanationEventSchema>;

// DB entity schemas — mirror the SQLite schema so collector / UI can type query results.

export const WorkspaceSchema = z.object({
  id: z.string(),
  path: z.string(),
  git_remote: z.string().nullable(),
  created_at: z.number().int(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  agent: z.string(),
  agent_version: z.string().nullable(),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable(),
  git_branch_start: z.string().nullable(),
  git_head_start: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const TurnSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  idx: z.number().int(),
  user_prompt: z.string(),
  agent_reasoning: z.string().nullable(),
  agent_final_message: z.string().nullable(),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable(),
  git_head: z.string().nullable(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  turn_id: z.string(),
  idx: z.number().int(),
  tool_name: z.string(),
  input_json: z.string(),
  output_json: z.string().nullable(),
  status: z.string().nullable(),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const EditSchema = z.object({
  id: z.string(),
  tool_call_id: z.string(),
  turn_id: z.string(),
  session_id: z.string(),
  workspace_id: z.string(),
  file_path: z.string(),
  before_hash: z.string().nullable(),
  after_hash: z.string(),
  created_at: z.number().int(),
  git_head: z.string().nullable(),
});
export type Edit = z.infer<typeof EditSchema>;

export const HunkSchema = z.object({
  id: z.string(),
  edit_id: z.string(),
  old_start: z.number().int().nullable(),
  old_count: z.number().int(),
  new_start: z.number().int(),
  new_count: z.number().int(),
  old_text: z.string().nullable(),
  new_text: z.string().nullable(),
  explanation: z.string().nullable(),
  explanation_model: z.string().nullable(),
  explained_at: z.number().int().nullable(),
});
export type Hunk = z.infer<typeof HunkSchema>;

export const LineBlameSchema = z.object({
  workspace_id: z.string(),
  file_path: z.string(),
  line_no: z.number().int(),
  content_hash: z.string(),
  edit_id: z.string(),
  turn_id: z.string(),
});
export type LineBlame = z.infer<typeof LineBlameSchema>;

export const AstNodeSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  file_path: z.string(),
  kind: z.string(),
  qualified_name: z.string().nullable(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  last_computed_at: z.number().int(),
});
export type AstNode = z.infer<typeof AstNodeSchema>;
