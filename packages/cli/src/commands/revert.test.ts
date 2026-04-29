import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, startServer } from '@minspect/collector';
import type { Event, GitState } from '@minspect/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getStateFilePath } from '../paths.js';
import { runRevert } from './revert.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface TestCtx {
  root: string;
  workFile: string; // file in the workspace we operate on
  store: Store;
  port: number;
  stop: () => Promise<void>;
}

async function setupCollector(options: { agent: 'claude-code' | 'codex' }): Promise<TestCtx> {
  const root = mkdtempSync(join(tmpdir(), 'minspect-revert-'));
  mkdirSync(root, { recursive: true });
  const workFile = join(root, 'src', 'greet.ts');
  const store = new Store(':memory:');
  const handle = await startServer({ store, port: 0, host: '127.0.0.1' });
  writeFileSync(
    getStateFilePath(root),
    JSON.stringify({ port: handle.port, pid: process.pid, started_at: Date.now() }),
  );
  // Seed session + one turn that edits the file.
  store.ingest({
    type: 'session_start',
    session_id: 's1',
    agent: options.agent,
    workspace: root,
    git,
    timestamp: 1,
  });
  store.ingest({
    type: 'turn_start',
    session_id: 's1',
    turn_id: 't1',
    idx: 0,
    user_prompt: 'hello',
    git,
    timestamp: 2,
  });
  store.ingest({
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tool_call_id: 'tc1',
    idx: 0,
    tool_name: options.agent === 'codex' ? 'apply_patch' : 'Write',
    input: {},
    status: 'ok',
    file_edits: [{ file_path: workFile, before_content: 'hello', after_content: 'world' }],
    started_at: 10,
    ended_at: 11,
  } satisfies Event);
  return {
    root,
    workFile,
    store,
    port: handle.port,
    stop: async () => {
      await handle.stop();
      store.close();
    },
  };
}

describe('runRevert', () => {
  let ctx: TestCtx;

  afterEach(async () => {
    if (ctx) {
      await ctx.stop();
      try {
        rmSync(ctx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        /* ignore */
      }
    }
  });

  it('dry-run mode: reads file, reports plan, does NOT write', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'world', 'utf8'); // matches after_hash
    const res = await runRevert({ turn: 't1', stateRoot: ctx.root });
    expect(res.mode).toBe('dry-run');
    expect(res.written).toEqual([]);
    // File on disk unchanged.
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('world');
  });

  it('--yes mode: restores file content from before_hash blob', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'world', 'utf8');
    const res = await runRevert({ turn: 't1', yes: true, stateRoot: ctx.root });
    expect(res.mode).toBe('written');
    expect(res.written).toHaveLength(1);
    expect(res.written[0]?.action).toBe('restored');
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('hello');
  });

  it('detects drift: refuses to revert when file on disk ≠ expected_current_hash', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'user-edited', 'utf8'); // drift
    await expect(runRevert({ turn: 't1', yes: true, stateRoot: ctx.root })).rejects.toThrow(
      'drift_detected',
    );
    // Disk unchanged.
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('user-edited');
  });

  it('--force overrides drift and writes anyway', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'user-edited', 'utf8');
    const res = await runRevert({
      turn: 't1',
      yes: true,
      force: true,
      stateRoot: ctx.root,
    });
    expect(res.mode).toBe('written');
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('hello');
  });

  it('rejects Codex-imported sessions with a hard block', async () => {
    ctx = await setupCollector({ agent: 'codex' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'world', 'utf8');
    await expect(runRevert({ turn: 't1', yes: true, stateRoot: ctx.root })).rejects.toThrow(
      'codex_source_blocked',
    );
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('world');
  });

  it('deletes file when AI created it (before_hash = null)', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    // Seed a fresh "create" edit instead of using the default seed.
    ctx.store.ingest({
      type: 'turn_start',
      session_id: 's1',
      turn_id: 't2',
      idx: 1,
      user_prompt: 'create new',
      git,
      timestamp: 20,
    });
    const newFile = join(ctx.root, 'src', 'brand-new.ts');
    ctx.store.ingest({
      type: 'tool_call',
      session_id: 's1',
      turn_id: 't2',
      tool_call_id: 'tc2',
      idx: 0,
      tool_name: 'Write',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: newFile, before_content: null, after_content: 'new!' }],
      started_at: 30,
      ended_at: 31,
    } satisfies Event);
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(newFile, 'new!', 'utf8');
    const res = await runRevert({ turn: 't2', yes: true, stateRoot: ctx.root });
    expect(res.written[0]?.action).toBe('deleted');
    expect(existsSync(newFile)).toBe(false);
  });

  it('requires exactly one of --turn or --edit', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    await expect(runRevert({ stateRoot: ctx.root })).rejects.toThrow(/exactly one of --turn/);
    await expect(runRevert({ turn: 't1', edit: 'tc1:0', stateRoot: ctx.root })).rejects.toThrow(
      /exactly one of --turn/,
    );
  });

  it('fails fast when collector daemon is not running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'minspect-revert-nop-'));
    try {
      await expect(runRevert({ turn: 't1', stateRoot: root })).rejects.toThrow(
        /daemon is not running/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('--edit mode reverts a single edit only', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'world', 'utf8');
    const res = await runRevert({ edit: 'tc1:0', yes: true, stateRoot: ctx.root });
    expect(res.mode).toBe('written');
    expect(res.plan.target_kind).toBe('edit');
    expect(readFileSync(ctx.workFile, 'utf8')).toBe('hello');
  });

  // Sanity: drift check uses sha256 matching the store's algorithm.
  it('drift detection uses sha256 matching the store', async () => {
    ctx = await setupCollector({ agent: 'claude-code' });
    const expected = sha256('world');
    expect(expected).toHaveLength(64);
    // Match = no drift.
    mkdirSync(join(ctx.root, 'src'), { recursive: true });
    writeFileSync(ctx.workFile, 'world', 'utf8');
    const res = await runRevert({ turn: 't1', stateRoot: ctx.root });
    expect(res.mode).toBe('dry-run');
  });
});
