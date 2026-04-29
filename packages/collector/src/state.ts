import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type SpawnedBy = 'user' | 'init' | 'hook';

export interface DaemonState {
  port: number;
  pid: number;
  started_at: number;
  // Who started this daemon — surfaced in /api/build-info + UI status bar so
  // the user always knows whether the background process is theirs or was
  // auto-spawned by a hook (card 43). Missing on older state.json files,
  // treated as `"user"` by readers.
  spawned_by?: SpawnedBy;
}

export function getStateDir(): string {
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'minspect');
  }
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'minspect');
}

export function getStateFilePath(dir: string = getStateDir()): string {
  return join(dir, 'state.json');
}

export function getDbPath(dir: string = getStateDir()): string {
  return join(dir, 'history.sqlite');
}

export function readState(dir: string = getStateDir()): DaemonState | null {
  const p = getStateFilePath(dir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DaemonState;
  } catch {
    return null;
  }
}

export function writeState(state: DaemonState, dir: string = getStateDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(getStateFilePath(dir), JSON.stringify(state, null, 2));
}
