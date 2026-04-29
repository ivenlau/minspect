import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getStateDir } from './paths.js';

// User-level preferences that survive across invocations but aren't strictly
// tied to one session or daemon. Kept deliberately tiny — if something wants
// to accumulate keys here, prefer a dedicated file or ask a `minspect init`
// question instead.

export interface MinspectConfig {
  // When true, `capture` will detach-spawn `minspect serve --quiet` the first
  // time it finds no running daemon. Default off — users must opt in via
  // `minspect init` (card 44) because a silent background process would
  // surprise someone who just wanted to install hooks.
  auto_spawn_daemon?: boolean;
}

export function getConfigPath(stateRoot: string = getStateDir()): string {
  return join(stateRoot, 'config.json');
}

export function readConfig(stateRoot?: string): MinspectConfig {
  const p = getConfigPath(stateRoot);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as MinspectConfig;
  } catch {
    return {};
  }
}

export function writeConfig(cfg: MinspectConfig, stateRoot?: string): void {
  const p = getConfigPath(stateRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}
