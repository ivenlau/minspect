import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExplainerConfig {
  enabled: boolean;
  model: string; // e.g. 'claude-haiku-4-5'
  api_key_env: string; // env var name; defaults to ANTHROPIC_API_KEY
  max_lines: number; // truncate hunks longer than this
  daily_usd_cap: number | null;
  blocklist_globs: string[]; // file path globs to skip
}

// Default disabled: the Claude Code path populates `tool_calls.explanation`
// from the agent's own transcript at Stop (no extra API cost). The LLM worker
// is kept as an opt-in fallback for agents without a transcript (Codex, Aider).
const DEFAULTS: ExplainerConfig = {
  enabled: false,
  model: 'claude-haiku-4-5',
  api_key_env: 'ANTHROPIC_API_KEY',
  max_lines: 200,
  daily_usd_cap: null,
  blocklist_globs: [],
};

export function loadConfig(stateRoot: string): ExplainerConfig {
  const p = join(stateRoot, 'config.json');
  if (!existsSync(p)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { explainer?: Partial<ExplainerConfig> };
    return { ...DEFAULTS, ...(raw.explainer ?? {}) };
  } catch {
    return DEFAULTS;
  }
}
