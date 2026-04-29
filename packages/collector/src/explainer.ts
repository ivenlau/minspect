import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { ExplainerConfig } from './explainer-config.js';
import type { Store } from './store.js';

// Stable cacheable prefix. Prompt caching on the Anthropic SDK: first request
// writes at ~1.25x; subsequent requests read the cached prefix at ~0.1x.
// Haiku 4.5 minimum cacheable prefix is 4096 tokens — this prompt is too
// small to trigger caching alone, but the shape is in place for when the
// system prompt grows (e.g. including a style guide per-project).
const SYSTEM_PROMPT = `You are a code-change explainer. Given a user prompt,
the tool call context, and a single code hunk (before/after), return one concise
sentence explaining WHY the hunk was made.

Rules:
- One sentence, present tense, no preamble ("This hunk..." is bad; start with a verb).
- Explain intent, not syntax. Avoid repeating the diff.
- If the hunk is trivial (comment only, whitespace), say so briefly.
- Never exceed 30 words.`;

export interface ExplainerRunOptions {
  maxItems?: number; // cap per invocation (default: drain until queue empty)
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function buildUserMessage(args: {
  userPrompt: string;
  toolName: string;
  filePath: string;
  oldText: string | null;
  newText: string | null;
  maxLines: number;
}): string {
  const truncate = (text: string | null): string => {
    if (!text) return '(empty)';
    const lines = text.split('\n');
    if (lines.length <= args.maxLines) return text;
    return `${lines.slice(0, args.maxLines).join('\n')}\n...(+${lines.length - args.maxLines} more lines)`;
  };
  return [
    `User prompt:\n${args.userPrompt || '(not recorded)'}`,
    `Tool: ${args.toolName}`,
    `File: ${args.filePath}`,
    '',
    '--- Before ---',
    truncate(args.oldText),
    '--- After ---',
    truncate(args.newText),
  ].join('\n');
}

interface ExplainContext {
  userPrompt: string;
  toolName: string;
  filePath: string;
  oldText: string | null;
  newText: string | null;
}

function loadHunkContext(store: Store, hunkId: string): ExplainContext | null {
  const hunk = store.db
    .prepare('SELECT edit_id, old_text, new_text FROM hunks WHERE id = ?')
    .get(hunkId) as
    | { edit_id: string; old_text: string | null; new_text: string | null }
    | undefined;
  if (!hunk) return null;
  const edit = store.db
    .prepare('SELECT tool_call_id, turn_id, file_path FROM edits WHERE id = ?')
    .get(hunk.edit_id) as { tool_call_id: string; turn_id: string; file_path: string } | undefined;
  if (!edit) return null;
  const toolCall = store.db
    .prepare('SELECT tool_name FROM tool_calls WHERE id = ?')
    .get(edit.tool_call_id) as { tool_name: string } | undefined;
  const turn = store.db.prepare('SELECT user_prompt FROM turns WHERE id = ?').get(edit.turn_id) as
    | { user_prompt: string }
    | undefined;
  return {
    userPrompt: turn?.user_prompt ?? '',
    toolName: toolCall?.tool_name ?? '(unknown)',
    filePath: edit.file_path,
    oldText: hunk.old_text,
    newText: hunk.new_text,
  };
}

// Enqueue a hunk for explanation. Called when new hunks are written by Store.
export function enqueueHunk(store: Store, hunkId: string): void {
  store.db
    .prepare(
      'INSERT OR IGNORE INTO explain_queue (hunk_id, enqueued_at, attempts) VALUES (?, ?, 0)',
    )
    .run(hunkId, Date.now());
}

// Inject an already-configured Anthropic client for testing.
export interface AnthropicLike {
  messages: {
    create(args: unknown): Promise<{
      content: Array<{ type: string; text?: string }>;
      model?: string;
      usage?: unknown;
    }>;
  };
}

export interface RunExplainerOptions extends ExplainerRunOptions {
  config: ExplainerConfig;
  anthropic?: AnthropicLike; // inject for tests; otherwise built from config
}

export async function runExplainer(
  store: Store,
  options: RunExplainerOptions,
): Promise<{ processed: number; cached: number; errors: number }> {
  const { config } = options;
  if (!config.enabled) return { processed: 0, cached: 0, errors: 0 };

  const client: AnthropicLike =
    options.anthropic ??
    (new Anthropic({ apiKey: process.env[config.api_key_env] }) as unknown as AnthropicLike);

  const max = options.maxItems ?? 100;
  const queue = store.db
    .prepare('SELECT hunk_id, attempts FROM explain_queue ORDER BY enqueued_at LIMIT ?')
    .all(max) as Array<{ hunk_id: string; attempts: number }>;

  let processed = 0;
  let cached = 0;
  let errors = 0;

  for (const item of queue) {
    const ctx = loadHunkContext(store, item.hunk_id);
    if (!ctx) {
      // orphan; drop
      store.db.prepare('DELETE FROM explain_queue WHERE hunk_id = ?').run(item.hunk_id);
      continue;
    }
    const userMessage = buildUserMessage({ ...ctx, maxLines: config.max_lines });
    const cacheKey = sha256(userMessage);

    // Check cache
    const cacheHit = store.db
      .prepare('SELECT explanation, model FROM explain_cache WHERE content_hash = ?')
      .get(cacheKey) as { explanation: string; model: string } | undefined;
    if (cacheHit) {
      store.db
        .prepare(
          'UPDATE hunks SET explanation = ?, explanation_model = ?, explained_at = ? WHERE id = ?',
        )
        .run(cacheHit.explanation, cacheHit.model, Date.now(), item.hunk_id);
      store.db.prepare('DELETE FROM explain_queue WHERE hunk_id = ?').run(item.hunk_id);
      cached += 1;
      processed += 1;
      continue;
    }

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: 256,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            // Cache the system prompt prefix; invalidates cheaply if we tune
            // the rules. See shared/prompt-caching.md.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });
      const explanation = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim();

      store.db
        .prepare(
          'INSERT OR REPLACE INTO explain_cache (content_hash, explanation, model, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(cacheKey, explanation, response.model ?? config.model, Date.now());
      store.db
        .prepare(
          'UPDATE hunks SET explanation = ?, explanation_model = ?, explained_at = ? WHERE id = ?',
        )
        .run(explanation, response.model ?? config.model, Date.now(), item.hunk_id);
      store.db.prepare('DELETE FROM explain_queue WHERE hunk_id = ?').run(item.hunk_id);
      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.db
        .prepare(
          'UPDATE explain_queue SET attempts = attempts + 1, last_error = ? WHERE hunk_id = ?',
        )
        .run(msg, item.hunk_id);
      errors += 1;
      if (item.attempts + 1 >= 3) {
        // drop after 3 attempts
        store.db.prepare('DELETE FROM explain_queue WHERE hunk_id = ?').run(item.hunk_id);
      }
    }
  }

  return { processed, cached, errors };
}
