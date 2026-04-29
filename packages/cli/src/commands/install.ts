import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Marker used to identify our hook block within a user's settings.json so
// repeat installs are idempotent (we replace our own block, not duplicate).
export const MARKER = '__minspect_managed__';

export interface InstallOptions {
  agent: 'claude-code';
  settingsPath?: string; // override for tests
  aiHistoryBin?: string; // absolute path to the minspect binary
  scope?: 'user' | 'project';
}

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; [MARKER]?: true }>;
}

interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

function claudeCodeSettingsPath(scope: 'user' | 'project'): string {
  if (scope === 'user') return join(homedir(), '.claude', 'settings.json');
  return join(process.cwd(), '.claude', 'settings.json');
}

function buildHookBlock(aiHistoryBin: string, eventName: string, matcher?: string): HookEntry {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [
      {
        type: 'command',
        command: `"${aiHistoryBin}" capture --event ${eventName}`,
        [MARKER]: true,
      },
    ],
  };
}

function desiredHooks(bin: string): Record<string, HookEntry[]> {
  return {
    SessionStart: [buildHookBlock(bin, 'session_start')],
    UserPromptSubmit: [buildHookBlock(bin, 'prompt_submit')],
    PreToolUse: [buildHookBlock(bin, 'pre_tool', 'Edit|Write|MultiEdit')],
    PostToolUse: [buildHookBlock(bin, 'post_tool', 'Edit|Write|MultiEdit|Bash')],
    Stop: [buildHookBlock(bin, 'stop')],
  };
}

function stripOurBlocks(entries: HookEntry[]): HookEntry[] {
  // Remove entries whose hooks are entirely ours (marker present).
  return entries
    .map((e) => ({
      ...e,
      hooks: e.hooks.filter((h) => !(h as { [MARKER]?: true })[MARKER]),
    }))
    .filter((e) => e.hooks.length > 0);
}

export interface InstallResult {
  path: string;
  backup?: string;
  wrote: boolean;
}

export function runInstall(options: InstallOptions): InstallResult {
  if (options.agent !== 'claude-code') {
    throw new Error(`unsupported agent: ${options.agent}`);
  }
  const bin = options.aiHistoryBin ?? process.argv[1] ?? 'minspect';
  const settingsPath = options.settingsPath ?? claudeCodeSettingsPath(options.scope ?? 'user');

  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Settings;
    } catch (e) {
      throw new Error(
        `Refusing to overwrite malformed settings at ${settingsPath}: ${(e as Error).message}`,
      );
    }
  }

  // Backup before we touch anything.
  let backup: string | undefined;
  if (existsSync(settingsPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${settingsPath}.bak.${ts}`;
    copyFileSync(settingsPath, backup);
  }

  const hooks = settings.hooks ?? {};
  const desired = desiredHooks(bin);
  for (const [event, desiredEntries] of Object.entries(desired)) {
    const existing = stripOurBlocks(hooks[event] ?? []);
    hooks[event] = [...existing, ...desiredEntries];
  }
  settings.hooks = hooks;

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { path: settingsPath, backup, wrote: true };
}
