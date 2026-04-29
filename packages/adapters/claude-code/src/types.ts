// Claude Code hook payload types (based on Claude Code's documented hook
// protocol). Kept here as a tight subset — parser tolerates extra fields.

import type { GitState } from '@minspect/core';

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

export interface ClaudeCodePayload {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: HookEventName;
  // event-specific:
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  source?: string;
}

export interface ParseContext {
  timestamp: number;
  git: GitState;
  // Filled by the CLI; adapter just shapes events.
  turn_id?: string;
  turn_idx?: number;
  tool_call_id?: string;
  tool_call_idx?: number;
  // CLI reads before_content in PreToolUse and after_content in PostToolUse
  // and passes them through here.
  file_edits?: Array<{
    file_path: string;
    before_content: string | null;
    after_content: string;
  }>;
  // For turn_end, fill from reasoning.extractReasoning if available.
  agent_reasoning?: string;
  agent_final_message?: string;
  agent_version?: string;
}

// Tool names that imply file edits. Non-file tools (Bash) still produce
// tool_call events but without file_edits.
export const FILE_EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
