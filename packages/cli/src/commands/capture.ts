import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  type ClaudeCodePayload,
  FILE_EDITING_TOOLS,
  type ParseContext,
  extractReasoning,
  parse,
} from '@minspect/adapter-claude-code';
import { type Event, readGitState } from '@minspect/core';
import { type SessionState, readSessionState, writeSessionState } from '../session-state.js';
import { sendEvent } from '../transport.js';

export interface CaptureOptions {
  stateRoot?: string; // override ~/.minspect for tests
  payload?: ClaudeCodePayload; // if not given, read from stdin
}

export async function readStdinJson(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readFileOrNull(p: string): string | null {
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

type ToolInput = {
  file_path?: string;
  // Write
  content?: string;
};

// Return list of file paths potentially affected by a tool call. Only
// Edit/Write/MultiEdit produce file changes we track.
function affectedFilePaths(toolName: string | undefined, toolInput: unknown): string[] {
  if (!toolName || !FILE_EDITING_TOOLS.has(toolName)) return [];
  const ti = (toolInput ?? {}) as ToolInput;
  return ti.file_path ? [ti.file_path] : [];
}

// Build file_edits for PostToolUse from stashed before + fresh after.
function buildFileEdits(
  state: SessionState,
  toolName: string | undefined,
  toolInput: unknown,
): ParseContext['file_edits'] {
  const paths = affectedFilePaths(toolName, toolInput);
  if (paths.length === 0) return undefined;
  return paths.map((file_path) => {
    const before = file_path in state.pretool_before ? state.pretool_before[file_path] : null;
    const after = readFileOrNull(file_path) ?? '';
    return {
      file_path,
      before_content: before ?? null,
      after_content: after,
    };
  });
}

export async function runCapture(options: CaptureOptions = {}): Promise<Event[]> {
  const payload = options.payload ?? (JSON.parse(await readStdinJson()) as ClaudeCodePayload);
  const state = readSessionState(payload.session_id, options.stateRoot);
  const git = readGitState(payload.cwd) ?? { branch: '', head: '', dirty: false };
  const now = Date.now();
  const events: Event[] = [];

  switch (payload.hook_event_name) {
    case 'SessionStart': {
      events.push(...parse(payload, { timestamp: now, git }));
      // Keep existing turn_idx when resuming a session so new turns don't
      // conflict with already-ingested ones via UNIQUE(session_id, idx).
      writeSessionState(
        {
          session_id: payload.session_id,
          turn_idx: state.turn_idx,
          current_turn_id: null,
          current_turn_started_at: null,
          tool_call_idx: 0,
          pretool_before: {},
        },
        options.stateRoot,
      );
      break;
    }

    case 'UserPromptSubmit': {
      const turn_id = randomUUID();
      events.push(
        ...parse(payload, {
          timestamp: now,
          git,
          turn_id,
          turn_idx: state.turn_idx,
        }),
      );
      state.current_turn_id = turn_id;
      state.current_turn_started_at = now;
      state.turn_idx += 1;
      state.tool_call_idx = 0;
      state.pretool_before = {};
      writeSessionState(state, options.stateRoot);
      break;
    }

    case 'PreToolUse': {
      // Capture before_content only. No event emitted.
      for (const fp of affectedFilePaths(payload.tool_name, payload.tool_input)) {
        state.pretool_before[fp] = readFileOrNull(fp);
      }
      writeSessionState(state, options.stateRoot);
      break;
    }

    case 'PostToolUse': {
      const tool_call_id = randomUUID();
      const file_edits = buildFileEdits(state, payload.tool_name, payload.tool_input);
      events.push(
        ...parse(payload, {
          timestamp: now,
          git,
          turn_id: state.current_turn_id ?? randomUUID(),
          tool_call_id,
          tool_call_idx: state.tool_call_idx,
          file_edits,
        }),
      );
      state.tool_call_idx += 1;
      // Clear the captured before for these paths so they don't leak to later
      // tool calls with different intent.
      for (const fp of affectedFilePaths(payload.tool_name, payload.tool_input)) {
        delete state.pretool_before[fp];
      }
      writeSessionState(state, options.stateRoot);
      break;
    }

    case 'Stop': {
      const reasoning = payload.transcript_path
        ? extractReasoning(payload.transcript_path)
        : { tool_explanations: [] };
      if (state.current_turn_id) {
        events.push(
          ...parse(payload, {
            timestamp: now,
            git,
            turn_id: state.current_turn_id,
            agent_reasoning: reasoning.agent_reasoning,
            agent_final_message: reasoning.agent_final_message,
          }),
        );
        // Per-tool-call explanation events — collector matches each back to
        // its tool_call row by (turn_id, tool_name, input content).
        for (const te of reasoning.tool_explanations ?? []) {
          const explanation = [te.preamble_thinking, te.preamble_text]
            .filter((s): s is string => Boolean(s))
            .join('\n\n');
          if (!explanation) continue;
          events.push({
            type: 'tool_call_explanation',
            turn_id: state.current_turn_id,
            tool_name: te.tool_name,
            input: te.input,
            explanation,
            timestamp: now,
          });
        }
      }
      state.current_turn_id = null;
      state.tool_call_idx = 0;
      state.pretool_before = {};
      writeSessionState(state, options.stateRoot);
      break;
    }
  }

  for (const e of events) {
    await sendEvent(e, options.stateRoot);
  }
  return events;
}
