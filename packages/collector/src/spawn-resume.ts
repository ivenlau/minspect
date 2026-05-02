import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';

const AGENT_COMMANDS: Record<string, (sessionId: string) => string> = {
  'claude-code': (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  opencode: (id) => `opencode --session ${id}`,
};

export interface SpawnResumeResult {
  ok: boolean;
  command: string;
  error?: string;
}

function fireAndForget(cmd: string, args: string[], env?: Record<string, string>): boolean {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: env ? { ...process.env, ...env } : undefined,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function spawnResume(
  agent: string,
  sessionId: string,
  workspacePath: string,
): SpawnResumeResult {
  const buildCmd = AGENT_COMMANDS[agent];
  if (!buildCmd) {
    return { ok: false, command: '', error: `unsupported_agent: ${agent}` };
  }
  const agentCmd = buildCmd(sessionId);
  const plat = platform;

  if (plat === 'win32') {
    return spawnWindows(agentCmd, workspacePath);
  }
  if (plat === 'darwin') {
    return spawnMacOS(agentCmd, workspacePath);
  }
  return spawnLinux(agentCmd, workspacePath);
}

// ── Windows ──────────────────────────────────────────────────────────

function findGitBashFromRegistry(): string | null {
  for (const root of ['HKLM', 'HKCU']) {
    const r = spawnSync('reg', ['query', `${root}\\SOFTWARE\\GitForWindows`, '/v', 'InstallPath'], {
      stdio: 'pipe',
      timeout: 3000,
    });
    if (r.status !== 0) continue;
    const out = r.stdout?.toString() ?? '';
    const m = /InstallPath\s+REG_SZ\s+(.+)/i.exec(out);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function spawnWindows(agentCmd: string, cwd: string): SpawnResumeResult {
  const gitDir = findGitBashFromRegistry();
  const extraEnv: Record<string, string> = {};
  if (gitDir) {
    extraEnv.CLAUDE_CODE_GIT_BASH_PATH = `${gitDir}\\bin\\bash.exe`;
  }

  // Write a temp .bat file. `start cmd /k <bat>` opens a visible cmd
  // window that runs the bat (and stays open via /k). The bat launches
  // PowerShell with -NoExit so the user lands in an interactive shell.
  const dir = mkdtempSync(join(tmpdir(), 'minspect-'));
  const batPath = join(dir, 'resume.bat');
  const psCmd = `cd '${cwd.replace(/'/g, "''")}'; ${agentCmd}`;
  const batContent = [
    '@echo off',
    `cd /d "${cwd}"`,
    `powershell -NoExit -Command "${psCmd.replace(/"/g, '\\"')}"`,
  ].join('\r\n');
  try {
    writeFileSync(batPath, batContent, 'utf8');
    if (fireAndForget('cmd', ['/c', 'start', 'minspect resume', 'cmd', '/k', batPath], extraEnv)) {
      setTimeout(() => {
        try {
          unlinkSync(batPath);
        } catch {
          /* ignore */
        }
        try {
          rmdirSync(dir);
        } catch {
          /* ignore */
        }
      }, 5000);
      return { ok: true, command: `cmd /k ${batPath}` };
    }
  } catch {
    /* fallback below */
  }

  const cmdK = `cd /d "${cwd}" && ${agentCmd}`;
  if (fireAndForget('cmd', ['/c', 'start', 'minspect resume', 'cmd', '/k', cmdK], extraEnv)) {
    return { ok: true, command: cmdK };
  }
  return { ok: false, command: cmdK, error: 'failed to spawn terminal' };
}

// ── macOS ────────────────────────────────────────────────────────────

// Escape a string for use inside an AppleScript double-quoted literal.
// AppleScript uses \" for double-quote and \\ for backslash.
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function spawnMacOS(agentCmd: string, cwd: string): SpawnResumeResult {
  // Single osascript call: activate Terminal, open a new tab/window, run
  // the command. No race condition — the script is executed atomically
  // by osascript which waits for Terminal.app.
  const shellLine = `cd ${quotePosix(cwd)} && ${agentCmd}`;
  const appleScript = [
    'tell application "Terminal"',
    '  activate',
    `  do script "${escapeAppleScript(shellLine)}"`,
    'end tell',
  ].join('\n');

  if (!fireAndForget('osascript', ['-e', appleScript])) {
    return { ok: false, command: agentCmd, error: 'failed to run osascript' };
  }
  return { ok: true, command: `osascript -e '...'` };
}

// ── Linux ────────────────────────────────────────────────────────────

interface TerminalDef {
  name: string;
  // Build args that open a new window and run `shellLine` inside it.
  buildArgs: (shellLine: string) => string[];
}

const TERMINALS: TerminalDef[] = [
  // x-terminal-emulator (Debian abstraction) — delegates to the system default.
  { name: 'x-terminal-emulator', buildArgs: (s) => ['-e', 'sh', '-c', s] },
  // xterm / konsole / alacritty / kitty — all use "-e cmd args..."
  { name: 'xterm', buildArgs: (s) => ['-e', 'sh', '-c', s] },
  { name: 'konsole', buildArgs: (s) => ['-e', 'sh', '-c', s] },
  { name: 'alacritty', buildArgs: (s) => ['-e', 'sh', '-c', s] },
  { name: 'kitty', buildArgs: (s) => ['-e', 'sh', '-c', s] },
  // gnome-terminal deprecated -e in favour of -- .
  { name: 'gnome-terminal', buildArgs: (s) => ['--', 'sh', '-c', s] },
];

function findTerminal(): TerminalDef | null {
  for (const def of TERMINALS) {
    // `command -v` is POSIX; `which` is not available on all distros.
    const r = spawnSync('sh', ['-c', `command -v ${def.name}`], { stdio: 'pipe', timeout: 3000 });
    if (r.status === 0 && r.stdout?.toString().trim()) return def;
  }
  return null;
}

function spawnLinux(agentCmd: string, cwd: string): SpawnResumeResult {
  const term = findTerminal();
  if (!term) {
    return {
      ok: false,
      command: agentCmd,
      error:
        'no terminal emulator found (install xterm, gnome-terminal, konsole, alacritty, or kitty)',
    };
  }

  // Build the shell command once — no double-escaping.
  const shellLine = `cd ${quotePosix(cwd)} ; ${agentCmd}`;
  const args = term.buildArgs(shellLine);

  if (!fireAndForget(term.name, args)) {
    return { ok: false, command: agentCmd, error: `failed to spawn ${term.name}` };
  }
  return { ok: true, command: `${term.name} ${args.join(' ')}` };
}

// ── Shared helpers ───────────────────────────────────────────────────

// Quote a path for POSIX shell (single-quote, escaping internal single-quotes).
function quotePosix(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
