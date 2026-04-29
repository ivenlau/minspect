import { copyFileSync, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStateDir } from '../paths.js';
import { BEGIN_MARKER as OPENCODE_BEGIN, END_MARKER as OPENCODE_END } from './install-opencode.js';
import { MARKER as CLAUDE_MARKER } from './install.js';
import { runStop } from './serve.js';

// Symmetric uninstaller for what each install* command writes. The managed
// markers are the contract — uninstall only touches bytes it can match back
// to something install wrote. User-authored hooks / plugin code / shell
// lines in post-commit are preserved verbatim.

const POST_COMMIT_BEGIN = '# >>> minspect managed >>>';
const POST_COMMIT_END = '# <<< minspect managed <<<';

export type UninstallAgent = 'claude-code' | 'opencode';

export interface UninstallOptions {
  agent?: UninstallAgent;
  all?: boolean;
  purge?: boolean;
  yes?: boolean;

  // Overrides for tests — mirror the install* options shape.
  settingsPath?: string; // claude-code settings.json
  pluginPath?: string; // opencode plugin file
  repoRoot?: string; // git repo for post-commit
  stateRoot?: string;
}

export interface UninstallStep {
  kind: 'claude-code-settings' | 'opencode-plugin' | 'post-commit' | 'stop-daemon' | 'purge-state';
  path?: string;
  detail?: string;
  // Result of executing — set when yes=true, undefined for dry-run.
  result?: 'removed' | 'stripped' | 'skipped' | 'failed';
  error?: string;
}

export interface UninstallResult {
  dryRun: boolean;
  steps: UninstallStep[];
}

function claudeCodeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function openCodePluginPath(): string {
  return join(homedir(), '.config', 'opencode', 'plugins', 'minspect.ts');
}

// Claude Code: walk `hooks.<Event>[].hooks[]` and drop any entry tagged with
// `__minspect_managed__: true`. Empty hook arrays collapse away so we don't
// leave `{SessionStart: []}` dangling.
function planClaudeCodeRemoval(settingsPath: string): UninstallStep {
  const step: UninstallStep = {
    kind: 'claude-code-settings',
    path: settingsPath,
  };
  if (!existsSync(settingsPath)) {
    step.detail = 'no settings.json';
    return step;
  }
  let body: string;
  try {
    body = readFileSync(settingsPath, 'utf8');
  } catch (e) {
    step.detail = `unreadable: ${(e as Error).message}`;
    return step;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    step.detail = 'malformed JSON (skipping)';
    return step;
  }
  type HookCmd = Record<string, unknown>;
  type HookEntry = { hooks?: HookCmd[] };
  const settings = parsed as Record<string, unknown> & {
    hooks?: Record<string, HookEntry[]>;
  };
  let removed = 0;
  if (settings.hooks && typeof settings.hooks === 'object') {
    const nextHooks: Record<string, HookEntry[]> = {};
    for (const ev of Object.keys(settings.hooks)) {
      const entries = settings.hooks[ev];
      if (!Array.isArray(entries)) continue;
      const kept: HookEntry[] = [];
      for (const entry of entries) {
        const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
        const filtered = hooks.filter(
          (h: HookCmd) => !(h as { [CLAUDE_MARKER]?: true })[CLAUDE_MARKER],
        );
        removed += hooks.length - filtered.length;
        if (filtered.length > 0) kept.push({ ...entry, hooks: filtered });
      }
      if (kept.length > 0) nextHooks[ev] = kept;
    }
    if (Object.keys(nextHooks).length === 0) {
      // Drop the hooks key entirely so we don't leave `{hooks: {}}` behind.
      settings.hooks = undefined;
    } else {
      settings.hooks = nextHooks;
    }
  }
  if (removed === 0) {
    step.detail = 'no managed hooks found';
    return step;
  }
  step.detail = `remove ${removed} managed hook entr${removed === 1 ? 'y' : 'ies'}`;
  // Stash the serialized result on the step for the executor.
  (step as UninstallStep & { _nextBody?: string })._nextBody = JSON.stringify(settings, null, 2);
  return step;
}

function executeClaudeCodeRemoval(step: UninstallStep): void {
  const next = (step as UninstallStep & { _nextBody?: string })._nextBody;
  if (next === undefined) {
    step.result = 'skipped';
    return;
  }
  if (!step.path) {
    step.result = 'failed';
    step.error = 'no path';
    return;
  }
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(step.path, `${step.path}.bak.${ts}`);
    writeFileSync(step.path, next);
    step.result = 'stripped';
  } catch (e) {
    step.result = 'failed';
    step.error = (e as Error).message;
  }
}

// OpenCode: two install modes → two removal modes. If the plugin file is
// entirely our template (everything between BEGIN and END is the whole
// file), delete it. If the user wrote content around the markers, strip the
// block and keep the rest.
function planOpenCodeRemoval(pluginPath: string): UninstallStep {
  const step: UninstallStep = { kind: 'opencode-plugin', path: pluginPath };
  if (!existsSync(pluginPath)) {
    step.detail = 'no plugin file';
    return step;
  }
  let content: string;
  try {
    content = readFileSync(pluginPath, 'utf8');
  } catch (e) {
    step.detail = `unreadable: ${(e as Error).message}`;
    return step;
  }
  if (!content.includes(OPENCODE_BEGIN) || !content.includes(OPENCODE_END)) {
    step.detail = 'no managed block';
    return step;
  }
  const begin = content.indexOf(OPENCODE_BEGIN);
  const end = content.indexOf(OPENCODE_END) + OPENCODE_END.length;
  const before = content.slice(0, begin).replace(/\n*$/, '');
  const after = content.slice(end).replace(/^\n*/, '');
  const rest = [before, after].filter(Boolean).join('\n').trim();
  const extra = step as UninstallStep & { _nextBody?: string; _delete?: boolean };
  if (rest.length === 0) {
    extra._delete = true;
    step.detail = 'delete managed plugin file';
  } else {
    extra._nextBody = `${rest}\n`;
    step.detail = 'strip managed block, keep user code';
  }
  return step;
}

function executeOpenCodeRemoval(step: UninstallStep): void {
  const extra = step as UninstallStep & { _nextBody?: string; _delete?: boolean };
  if (!step.path || (!extra._nextBody && !extra._delete)) {
    step.result = 'skipped';
    return;
  }
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(step.path, `${step.path}.bak.${ts}`);
    if (extra._delete) {
      unlinkSync(step.path);
      step.result = 'removed';
    } else {
      writeFileSync(step.path, extra._nextBody ?? '');
      step.result = 'stripped';
    }
  } catch (e) {
    step.result = 'failed';
    step.error = (e as Error).message;
  }
}

// Post-commit: single shell file with our BEGIN/END block. Strip it; if
// the remainder is empty or just a shebang, delete the whole file so we
// don't leave a no-op hook behind.
function planPostCommitRemoval(repoRoot: string): UninstallStep {
  const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
  const step: UninstallStep = { kind: 'post-commit', path: hookPath };
  if (!existsSync(hookPath)) {
    step.detail = 'no post-commit hook';
    return step;
  }
  let content: string;
  try {
    content = readFileSync(hookPath, 'utf8');
  } catch (e) {
    step.detail = `unreadable: ${(e as Error).message}`;
    return step;
  }
  if (!content.includes(POST_COMMIT_BEGIN)) {
    step.detail = 'no managed block';
    return step;
  }
  const re = new RegExp(
    `\\n?${escapeRegex(POST_COMMIT_BEGIN)}[\\s\\S]*?${escapeRegex(POST_COMMIT_END)}\\n?`,
    'g',
  );
  const stripped = content.replace(re, '');
  const bodyTrimmed = stripped.replace(/^#!\s*\S+\s*\n?/, '').trim();
  const extra = step as UninstallStep & { _nextBody?: string; _delete?: boolean };
  if (bodyTrimmed.length === 0) {
    extra._delete = true;
    step.detail = 'delete post-commit (empty after strip)';
  } else {
    extra._nextBody = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
    step.detail = 'strip managed block, keep user hook';
  }
  return step;
}

function executePostCommitRemoval(step: UninstallStep): void {
  const extra = step as UninstallStep & { _nextBody?: string; _delete?: boolean };
  if (!step.path || (!extra._nextBody && !extra._delete)) {
    step.result = 'skipped';
    return;
  }
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(step.path, `${step.path}.bak.${ts}`);
    if (extra._delete) {
      unlinkSync(step.path);
      step.result = 'removed';
    } else {
      writeFileSync(step.path, extra._nextBody ?? '');
      step.result = 'stripped';
    }
  } catch (e) {
    step.result = 'failed';
    step.error = (e as Error).message;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function planPurgeState(stateRoot: string): UninstallStep {
  const step: UninstallStep = {
    kind: 'purge-state',
    path: stateRoot,
    detail: 'delete history.sqlite*, sessions/, queue/',
  };
  return step;
}

function executePurgeState(step: UninstallStep): void {
  if (!step.path) {
    step.result = 'skipped';
    return;
  }
  const root = step.path;
  let removed = 0;
  for (const name of ['history.sqlite', 'history.sqlite-wal', 'history.sqlite-shm']) {
    const p = join(root, name);
    try {
      if (existsSync(p)) {
        unlinkSync(p);
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  for (const dir of ['sessions', 'queue']) {
    const p = join(root, dir);
    try {
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  step.detail = `${step.detail ?? ''} (removed ${removed})`;
  step.result = removed > 0 ? 'removed' : 'skipped';
}

function isGitRepo(root: string): boolean {
  return existsSync(join(root, '.git'));
}

// Build the plan. Execution is a separate pass so we can always print the
// same plan in dry-run mode without duplicating logic.
export function planUninstall(options: UninstallOptions): UninstallStep[] {
  const { agent, all } = options;
  const steps: UninstallStep[] = [];

  const doClaude = all || agent === 'claude-code';
  const doOpenCode = all || agent === 'opencode';

  if (doClaude) {
    steps.push(planClaudeCodeRemoval(options.settingsPath ?? claudeCodeSettingsPath()));
  }
  if (doOpenCode) {
    steps.push(planOpenCodeRemoval(options.pluginPath ?? openCodePluginPath()));
  }
  if (all) {
    const repo = options.repoRoot ?? process.cwd();
    if (isGitRepo(repo)) {
      steps.push(planPostCommitRemoval(repo));
    }
    steps.push({ kind: 'stop-daemon' });
  }
  if (options.purge) {
    steps.push(planPurgeState(options.stateRoot ?? getStateDir()));
  }
  return steps;
}

export async function runUninstall(options: UninstallOptions): Promise<UninstallResult> {
  if (!options.agent && !options.all) {
    throw new Error('specify --agent <claude-code|opencode> or --all');
  }
  const steps = planUninstall(options);
  const dryRun = options.yes !== true;
  if (dryRun) return { dryRun, steps };

  for (const step of steps) {
    switch (step.kind) {
      case 'claude-code-settings':
        executeClaudeCodeRemoval(step);
        break;
      case 'opencode-plugin':
        executeOpenCodeRemoval(step);
        break;
      case 'post-commit':
        executePostCommitRemoval(step);
        break;
      case 'stop-daemon': {
        try {
          const stopped = await runStop({ stateRoot: options.stateRoot });
          step.result = stopped ? 'removed' : 'skipped';
          step.detail = stopped ? 'daemon stopped' : 'no daemon running';
        } catch (e) {
          step.result = 'failed';
          step.error = (e as Error).message;
        }
        break;
      }
      case 'purge-state':
        executePurgeState(step);
        break;
    }
  }
  return { dryRun: false, steps };
}

// Format a plan for stdout (CLI dry-run output + post-execution summary).
export function formatUninstallReport(result: UninstallResult): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? 'dry-run plan:' : 'uninstall result:');
  for (const step of result.steps) {
    const pathStr = step.path ? ` (${step.path})` : '';
    const detail = step.detail ?? '';
    const resultTag = step.result ? ` [${step.result}]` : '';
    lines.push(`  ${step.kind}${pathStr}: ${detail}${resultTag}`);
    if (step.error) lines.push(`    error: ${step.error}`);
  }
  if (result.dryRun) {
    lines.push('');
    lines.push('re-run with --yes to apply.');
  }
  return `${lines.join('\n')}\n`;
}
