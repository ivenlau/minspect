import { type StartDaemonOptions, runStartDaemonDetached } from './init.js';

// Lightweight "daemon is down, get it back up" command. Deliberately does
// NOT touch hooks, config.json, or autostart — those are init's job. If
// you want to re-run setup, use `minspect init`. If the daemon crashed
// and you just want to bring it back, use `start`.

export interface StartOptions {
  stateRoot?: string;
  // Test seams (forwarded to runStartDaemonDetached).
  findRunningDaemon?: StartDaemonOptions['findRunningDaemon'];
  spawnServe?: StartDaemonOptions['spawnServe'];
  waitForDaemon?: StartDaemonOptions['waitForDaemon'];
  openBrowserFn?: StartDaemonOptions['openBrowserFn'];
}

export interface StartResult {
  daemonStarted: boolean;
  port?: number;
  spawned: boolean;
  // When `daemonStarted` is false and `spawned` is true, distinguishes
  // "spawn() returned null" (rare — usually means argv[1] missing)
  // from "spawn succeeded but /health never 200'd in 5s". The CLI
  // surface prints a different hint for each.
  spawnFailed: boolean;
}

export async function runStart(options: StartOptions = {}): Promise<StartResult> {
  const r = await runStartDaemonDetached({
    stateRoot: options.stateRoot,
    spawnedBy: 'user',
    openBrowser: false,
    findRunningDaemon: options.findRunningDaemon,
    spawnServe: options.spawnServe,
    waitForDaemon: options.waitForDaemon,
    openBrowserFn: options.openBrowserFn,
  });
  return {
    daemonStarted: r.daemonStarted,
    port: r.port,
    spawned: r.spawned,
    spawnFailed: r.spawnFailed,
  };
}
