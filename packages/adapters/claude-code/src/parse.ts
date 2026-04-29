import type { Event } from '@minspect/core';
import type { ClaudeCodePayload, ParseContext } from './types.js';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(`${message} (field: ${field})`);
  }
}

function requireField<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new ParseError('missing required field', field);
  }
  return value;
}

export function parse(payload: ClaudeCodePayload, ctx: ParseContext): Event[] {
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return [
        {
          type: 'session_start',
          session_id: requireField(payload.session_id, 'session_id'),
          agent: 'claude-code',
          agent_version: ctx.agent_version,
          workspace: requireField(payload.cwd, 'cwd'),
          git: ctx.git,
          timestamp: ctx.timestamp,
        },
      ];

    case 'UserPromptSubmit':
      return [
        {
          type: 'turn_start',
          session_id: requireField(payload.session_id, 'session_id'),
          turn_id: requireField(ctx.turn_id, 'turn_id'),
          idx: requireField(ctx.turn_idx, 'turn_idx'),
          user_prompt: payload.prompt ?? '',
          git: ctx.git,
          timestamp: ctx.timestamp,
        },
      ];

    case 'PreToolUse':
      // PreToolUse doesn't emit an event by itself — CLI uses it only to
      // capture before_content before the tool runs.
      return [];

    case 'PostToolUse': {
      const toolName = requireField(payload.tool_name, 'tool_name');
      return [
        {
          type: 'tool_call',
          session_id: requireField(payload.session_id, 'session_id'),
          turn_id: requireField(ctx.turn_id, 'turn_id'),
          tool_call_id: requireField(ctx.tool_call_id, 'tool_call_id'),
          idx: requireField(ctx.tool_call_idx, 'tool_call_idx'),
          tool_name: toolName,
          input: payload.tool_input ?? {},
          output: payload.tool_response,
          status: 'ok',
          file_edits: ctx.file_edits,
          started_at: ctx.timestamp,
          ended_at: ctx.timestamp,
        },
      ];
    }

    case 'Stop':
      // Stop marks end-of-turn. Emit turn_end. Session end is separately
      // inferred (SessionStart + idle timeout or user close); we do NOT emit
      // session_end from Stop.
      return [
        {
          type: 'turn_end',
          turn_id: requireField(ctx.turn_id, 'turn_id'),
          agent_reasoning: ctx.agent_reasoning,
          agent_final_message: ctx.agent_final_message,
          timestamp: ctx.timestamp,
        },
      ];
  }
}
