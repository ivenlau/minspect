import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { EventSchema } from '@minspect/core';
import { getAppAssetsDir, getAppHtml, getBuildHash } from '@minspect/ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerApi } from './api.js';
import { type LinkCommitRequest, linkCommit } from './commit-link.js';
import { startHourlyCodexImport } from './refresh.js';
import type { Store } from './store.js';

// Captured once at module load. The server-code mtime lets a new `minspect
// serve` invocation decide whether the running daemon is from a prior build
// (if dist/index.js has been touched after this daemon started, the user
// rebuilt code the daemon doesn't know about).
const SERVER_STARTED_AT = Date.now();
const SERVER_CODE_MTIME = (() => {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtimeMs;
  } catch {
    return 0;
  }
})();

export function createServer(store: Store): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  // Identify the running build so the SPA can detect version drift (daemon
  // rebuilt but browser tab still on the old JS) and the CLI can refuse to
  // reuse a stale daemon from a prior code revision. See card 26.
  app.get('/api/build-info', async () => ({
    ui_hash: getBuildHash(),
    server_started_at: SERVER_STARTED_AT,
    server_code_mtime: SERVER_CODE_MTIME,
    // Who started this daemon. Lets the UI status bar tell users whether the
    // background process was theirs or was auto-spawned by a hook.
    spawned_by:
      process.env.MINSPECT_SPAWNED_BY === 'hook'
        ? 'hook'
        : process.env.MINSPECT_SPAWNED_BY === 'init'
          ? 'init'
          : 'user',
  }));

  // SPA bundle: Vite build output lives in @minspect/ui's dist/spa/. Register
  // the asset tree first, then fall through to the HTML shell on `/`.
  const assetsDir = getAppAssetsDir();
  if (existsSync(assetsDir)) {
    void app.register(fastifyStatic, {
      root: assetsDir,
      prefix: '/',
      decorateReply: false,
      index: false, // we route GET / manually below to control 503 behavior
    });
  }

  app.get('/', async (_req, reply) => {
    try {
      return reply.type('text/html').send(getAppHtml());
    } catch {
      return reply
        .code(503)
        .type('text/plain')
        .send('UI not built; run: pnpm -C packages/ui build');
    }
  });

  app.post('/events', async (req, reply) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_error',
        issues: parsed.error.issues,
      });
    }
    try {
      store.ingest(parsed.data);
    } catch (err) {
      return reply.code(500).send({
        error: 'ingest_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return reply.code(200).send({ ok: true });
  });

  registerApi(app, store);

  app.post('/commit-links', async (req, reply) => {
    const body = req.body as Partial<LinkCommitRequest> | null;
    if (
      !body ||
      typeof body.commit_sha !== 'string' ||
      typeof body.workspace !== 'string' ||
      !Array.isArray(body.changed_files)
    ) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }
    try {
      const result = linkCommit(store, {
        commit_sha: body.commit_sha,
        workspace: body.workspace,
        changed_files: body.changed_files,
        time_window_ms: body.time_window_ms,
        confidence: body.confidence,
      });
      return reply.code(200).send(result);
    } catch (err) {
      return reply.code(500).send({
        error: 'link_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

export interface StartOptions {
  store: Store;
  port?: number;
  host?: string;
}

export async function startServer(
  opts: StartOptions,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const app = createServer(opts.store);
  await app.listen({ port: opts.port ?? 0, host: opts.host ?? '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Unexpected listen address');
  }
  // Hourly background `import-codex --all --since 1d` — catches sessions
  // the user created while this daemon was down. Disposer is called on
  // stop() so test runs don't leak timers.
  const stopHourly = startHourlyCodexImport();
  return {
    port: addr.port,
    stop: async () => {
      stopHourly();
      await app.close();
    },
  };
}
