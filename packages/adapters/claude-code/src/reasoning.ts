import { readFileSync } from 'node:fs';

// Claude Code's transcript is JSONL. Each line is an object with at least
// `role` (or `message.role`) and `content` (or `message.content`). For
// assistant messages, `content` is an array of content blocks, each with a
// `type`:
//   - 'thinking' → `{thinking: string}`
//   - 'text'     → `{text: string}`
//   - 'tool_use' → `{id, name, input}`
// `tool_result` and other types are irrelevant here.
//
// Observed structural pattern (verified against real transcripts):
//   assistant msg A  (text "I'll edit foo.ts...", stop_reason:"tool_use")
//   assistant msg B  (tool_use {name:"Edit", input:{...}})
//   user msg C       (tool_result)
// i.e. the preamble text/thinking lives in a SEPARATE assistant message that
// precedes the tool_use message. We walk forward and attribute the most
// recent text/thinking block to the next tool_use(s) in the same turn.

export interface PreambleToolExplanation {
  tool_name: string;
  input: unknown;
  preamble_text?: string;
  preamble_thinking?: string;
}

export interface ExtractedReasoning {
  agent_reasoning?: string;
  agent_final_message?: string;
  tool_explanations: PreambleToolExplanation[];
}

interface AssistantBlock {
  type?: string;
  thinking?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface TranscriptLine {
  role?: string;
  message?: { role?: string; content?: AssistantBlock[] | string };
  content?: AssistantBlock[] | string;
}

function getRole(obj: TranscriptLine): string | undefined {
  return obj.role ?? obj.message?.role;
}

function getContent(obj: TranscriptLine): AssistantBlock[] | string | undefined {
  return obj.content ?? obj.message?.content;
}

function parseJsonLines(raw: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as TranscriptLine);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function extractReasoning(transcriptPath: string): ExtractedReasoning {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return { tool_explanations: [] };
  }

  const lines = parseJsonLines(raw);

  // Pass 1: forward walk. Maintain a rolling preamble; each tool_use consumes it.
  const tool_explanations: PreambleToolExplanation[] = [];
  let preambleText: string | undefined;
  let preambleThinking: string | undefined;

  for (const obj of lines) {
    if (getRole(obj) !== 'assistant') continue;
    const content = getContent(obj);
    if (!content || typeof content === 'string') continue;

    const toolUses = content.filter((b) => b.type === 'tool_use');
    const texts = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    const thinkings = content
      .filter((b) => b.type === 'thinking' && typeof b.thinking === 'string')
      .map((b) => b.thinking as string);

    if (toolUses.length === 0) {
      // Preamble-only assistant message; store as rolling preamble.
      if (texts.length > 0) preambleText = texts.join('\n\n');
      if (thinkings.length > 0) preambleThinking = thinkings.join('\n\n');
      continue;
    }

    // Assistant message contains tool_use(s). Any text/thinking in this SAME
    // message (if the model put them inline) takes precedence over the rolling
    // preamble.
    const inlineText = texts.length > 0 ? texts.join('\n\n') : undefined;
    const inlineThinking = thinkings.length > 0 ? thinkings.join('\n\n') : undefined;
    const useText = inlineText ?? preambleText;
    const useThinking = inlineThinking ?? preambleThinking;

    for (const tu of toolUses) {
      if (typeof tu.name !== 'string') continue;
      tool_explanations.push({
        tool_name: tu.name,
        input: tu.input ?? {},
        preamble_text: useText,
        preamble_thinking: useThinking,
      });
    }

    // Consume the preamble once used.
    preambleText = undefined;
    preambleThinking = undefined;
  }

  // Pass 2: scan backwards for final message and reasoning. The last assistant
  // message typically holds the final text reply; thinking blocks may live in
  // an earlier assistant message (the model emits thinking then tool_use in
  // separate messages). Walk backwards collecting both.
  let agent_reasoning: string | undefined;
  let agent_final_message: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = lines[i];
    if (!obj || getRole(obj) !== 'assistant') continue;
    const content = getContent(obj);
    if (!content) break;
    if (typeof content === 'string') {
      agent_final_message = content;
      break;
    }
    const texts = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    const thinkings = content
      .filter((b) => b.type === 'thinking' && typeof b.thinking === 'string')
      .map((b) => b.thinking as string);
    if (!agent_final_message && texts.length > 0) agent_final_message = texts.join('\n\n');
    if (!agent_reasoning && thinkings.length > 0) agent_reasoning = thinkings.join('\n\n');
    if (agent_final_message && agent_reasoning) break;
  }

  return { agent_reasoning, agent_final_message, tool_explanations };
}
