import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function getStateDir(): string {
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'minspect');
  }
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'minspect');
}

export function getSessionStatePath(sessionId: string, root: string = getStateDir()): string {
  return join(root, 'sessions', `${sessionId}.json`);
}

export function getQueueDir(root: string = getStateDir()): string {
  return join(root, 'queue');
}

export function getStateFilePath(root: string = getStateDir()): string {
  return join(root, 'state.json');
}
