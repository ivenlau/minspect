import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { computeBlameAtEdit } from './blame.js';
import { detectBadgesForTurn } from './detectors.js';
import { isRefreshRunning, runRefresh } from './refresh.js';
import { getStateDir } from './state.js';
import type { Store } from './store.js';

// Tiny per-handler TTL cache. The dashboard endpoint is the only hot-path
// heavy handler today (detectors.ts runs per turn on every poll); 20 s TTL
// is well under the UI's 5 s poll interval from the user's perspective but
// gives us ~75% hit rate. Key = handler label.
interface CacheEntry<T> {
  value: T;
  expires_at: number;
}
const CACHE = new Map<string, CacheEntry<unknown>>();

function withTtlCache<T>(key: string, ttlMs: number, compute: () => T): T {
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit && hit.expires_at > now) return hit.value as T;
  const value = compute();
  CACHE.set(key, { value, expires_at: now + ttlMs });
  return value;
}

// Exported for tests — lets us clear cache between cases.
export function _clearApiCache(): void {
  CACHE.clear();
}

// Dashboard activity-window config. Adding a new range = add an entry here
// plus one option in the UI dropdown. `sqlBucket` is the strftime-style
// expression that groups `edits.created_at` into the right bucket key;
// `fillBuckets` generates the full bucket-key list so zero-activity periods
// still show as empty bars (chart shape matters even when idle).
export type DashboardRange = 'today' | 'week' | '30d' | 'year';

export function normalizeRange(raw: string | undefined): DashboardRange {
  if (raw === 'today' || raw === 'week' || raw === 'year') return raw;
  return '30d'; // default, also the fallback for unknown values
}

interface RangeConfig {
  since: number;
  prevStart: number;
  sqlBucket: string; // SQLite expression for the bucket key
  fillBuckets: () => string[]; // ordered bucket keys (oldest → newest)
}

function rangeConfig(range: DashboardRange, now: number): RangeConfig {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hourKey = (d: Date) => `${dayKey(d)} ${pad2(d.getHours())}`;
  const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

  if (range === 'today') {
    // Start of today in local time; bucket hourly. Buckets for 0..currentHour.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.getTime();
    const prevStart = since - DAY; // yesterday same window for delta
    return {
      since,
      prevStart,
      sqlBucket: `strftime('%Y-%m-%d %H', created_at/1000, 'unixepoch', 'localtime')`,
      fillBuckets: () => {
        const out: string[] = [];
        const currentHour = new Date(now).getHours();
        for (let h = 0; h <= currentHour; h++) {
          const d = new Date(since + h * HOUR);
          out.push(hourKey(d));
        }
        return out;
      },
    };
  }

  if (range === 'week') {
    // Last 7 calendar days including today (rolling window, not ISO week).
    const since = now - 6 * DAY;
    const sinceDay = new Date(since);
    sinceDay.setHours(0, 0, 0, 0);
    const sinceMs = sinceDay.getTime();
    const prevStart = sinceMs - 7 * DAY;
    return {
      since: sinceMs,
      prevStart,
      sqlBucket: `date(created_at/1000, 'unixepoch', 'localtime')`,
      fillBuckets: () => {
        const out: string[] = [];
        for (let i = 6; i >= 0; i--) out.push(dayKey(new Date(now - i * DAY)));
        return out;
      },
    };
  }

  if (range === 'year') {
    // Last 12 calendar months including the current one.
    const d0 = new Date(now);
    const startOfMonth = new Date(d0.getFullYear(), d0.getMonth() - 11, 1);
    const since = startOfMonth.getTime();
    const prevStart = new Date(d0.getFullYear() - 1, d0.getMonth() - 11, 1).getTime();
    return {
      since,
      prevStart,
      sqlBucket: `strftime('%Y-%m', created_at/1000, 'unixepoch', 'localtime')`,
      fillBuckets: () => {
        const out: string[] = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
          out.push(monthKey(d));
        }
        return out;
      },
    };
  }

  // Default 30d: rolling window of 30 daily buckets (existing behavior).
  const THIRTY = 30 * DAY;
  const since = now - THIRTY;
  return {
    since,
    prevStart: since - THIRTY,
    sqlBucket: `date(created_at/1000, 'unixepoch', 'localtime')`,
    fillBuckets: () => {
      const out: string[] = [];
      for (let i = 29; i >= 0; i--) out.push(dayKey(new Date(now - i * DAY)));
      return out;
    },
  };
}

// UI-facing read endpoints.
export function registerApi(app: FastifyInstance, store: Store): void {
  // Aggregate workspaces — drives the left sidebar in the new React UI.
  app.get('/api/workspaces', async () => {
    const rows = store.db
      .prepare(
        `SELECT w.id AS path,
                (SELECT COUNT(*) FROM sessions s WHERE s.workspace_id = w.id) AS session_count,
                (SELECT COUNT(*) FROM edits e WHERE e.workspace_id = w.id) AS total_edits,
                (SELECT MAX(s.started_at) FROM sessions s WHERE s.workspace_id = w.id) AS last_activity
         FROM workspaces w
         ORDER BY last_activity DESC NULLS LAST`,
      )
      .all() as Array<{
      path: string;
      session_count: number;
      total_edits: number;
      last_activity: number | null;
    }>;
    return { workspaces: rows };
  });

  // Sessions for a single workspace — lazy-loaded by the sidebar when a
  // workspace branch is expanded.
  app.get('/api/workspaces/:path/sessions', async (req) => {
    const { path: pathParam } = req.params as { path: string };
    const path = decodeURIComponent(pathParam);
    const rows = store.db
      .prepare(
        `SELECT id, workspace_id, agent, agent_version, started_at, ended_at
         FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC`,
      )
      .all(path);
    return { sessions: rows };
  });

  // Full workspace detail — drives the Workspace page (card 23). One query
  // per aggregate to keep SQL readable; the whole handler is <20ms in
  // practice even with 1000+ edits.
  app.get('/api/workspaces/:path', async (req, reply) => {
    const { path: pathParam } = req.params as { path: string };
    const path = decodeURIComponent(pathParam);
    const ws = store.db.prepare('SELECT id, created_at FROM workspaces WHERE id = ?').get(path) as
      | { id: string; created_at: number }
      | undefined;
    if (!ws) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const counts = store.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM sessions WHERE workspace_id = ?) AS session_count,
           (SELECT COUNT(*) FROM turns WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)) AS turn_count,
           (SELECT COUNT(*) FROM edits WHERE workspace_id = ?) AS edit_count,
           (SELECT COUNT(DISTINCT file_path) FROM edits WHERE workspace_id = ?) AS files_touched,
           (SELECT MAX(s.started_at) FROM sessions s WHERE s.workspace_id = ?) AS last_activity`,
      )
      .get(path, path, path, path, path) as {
      session_count: number;
      turn_count: number;
      edit_count: number;
      files_touched: number;
      last_activity: number | null;
    };
    const sessions = store.db
      .prepare(
        `SELECT s.id, s.agent, s.agent_version, s.started_at, s.ended_at,
                (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
                (SELECT COUNT(DISTINCT e.file_path) FROM edits e WHERE e.session_id = s.id) AS file_count
         FROM sessions s WHERE s.workspace_id = ? ORDER BY s.started_at DESC`,
      )
      .all(path) as Array<{
      id: string;
      agent: string;
      agent_version: string | null;
      started_at: number;
      ended_at: number | null;
      turn_count: number;
      file_count: number;
    }>;
    const agentsArr = store.db
      .prepare('SELECT DISTINCT agent FROM sessions WHERE workspace_id = ? ORDER BY agent')
      .all(path) as Array<{ agent: string }>;
    const files = store.db
      .prepare(
        `SELECT file_path, COUNT(*) AS edit_count, MAX(created_at) AS last_edited
         FROM edits WHERE workspace_id = ? GROUP BY file_path ORDER BY edit_count DESC LIMIT 500`,
      )
      .all(path) as Array<{ file_path: string; edit_count: number; last_edited: number }>;
    return {
      path: ws.id,
      created_at: ws.created_at,
      ...counts,
      agents: agentsArr.map((a) => a.agent),
      sessions,
      files,
    };
  });

  // Dashboard aggregate: activity sparkline, top workspaces, top agents,
  // alerts from detectors, recent event feed. One HTTP call drives the
  // whole Dashboard page; polling it every 5s is cheap (<5ms with the
  // current indexes). The `range` query param lets the UI switch window
  // without re-loading the page.
  app.get('/api/dashboard', async (req) => {
    const range = normalizeRange((req.query as { range?: string }).range);
    return withTtlCache(`dashboard:${range}`, 20_000, () => computeDashboard(store, range));
  });

  // Build the activity buckets + matching delta-previous-window for a given
  // range. Today → hourly bars (24); week → daily (7); 30d → daily (30);
  // year → monthly (12). Using SQLite's strftime keeps the aggregation
  // single-query even when bucket granularity shifts.
  function computeActivity(
    store: Store,
    range: DashboardRange,
    now: number,
  ): {
    activity: Array<{ day: string; edits: number }>;
    total: number;
    delta_pct: number | null;
  } {
    const { since, prevStart, sqlBucket, fillBuckets } = rangeConfig(range, now);

    const rawActivity = store.db
      .prepare(
        `SELECT ${sqlBucket} AS day, COUNT(*) AS edits
         FROM edits WHERE created_at >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(since) as Array<{ day: string; edits: number }>;
    const byDay = new Map(rawActivity.map((r) => [r.day, r.edits]));
    const activity = fillBuckets().map((key) => ({ day: key, edits: byDay.get(key) ?? 0 }));
    const total = activity.reduce((s, a) => s + a.edits, 0);

    const prevRow = store.db
      .prepare('SELECT COUNT(*) AS n FROM edits WHERE created_at >= ? AND created_at < ?')
      .get(prevStart, since) as { n: number };
    const delta_pct = prevRow.n === 0 ? null : ((total - prevRow.n) / prevRow.n) * 100;
    return { activity, total, delta_pct };
  }

  function computeDashboard(store_: Store, range: DashboardRange = '30d') {
    const now = Date.now();
    // Rename local alias so the body below stays readable.
    const store = store_;

    const { activity, total: totalEdits, delta_pct } = computeActivity(store, range, now);

    const topWorkspaces = store.db
      .prepare(
        `SELECT workspace_id AS path, COUNT(*) AS edits
         FROM edits GROUP BY workspace_id ORDER BY edits DESC LIMIT 5`,
      )
      .all() as Array<{ path: string; edits: number }>;

    const topAgentsRaw = store.db
      .prepare(
        'SELECT agent, COUNT(*) AS sessions FROM sessions GROUP BY agent ORDER BY sessions DESC',
      )
      .all() as Array<{ agent: string; sessions: number }>;
    const totalSessions = topAgentsRaw.reduce((s, a) => s + a.sessions, 0);
    const topAgents = topAgentsRaw.map((a) => ({
      ...a,
      pct: totalSessions === 0 ? 0 : (a.sessions / totalSessions) * 100,
    }));

    // Alerts: run detectors on recent turns (last 7d), aggregate badges by
    // level. Danger first.
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentTurns = store.db
      .prepare('SELECT id FROM turns WHERE started_at >= ? ORDER BY started_at DESC LIMIT 200')
      .all(sevenDaysAgo) as Array<{ id: string }>;
    const alertBuckets = new Map<string, { level: string; label: string; count: number }>();
    for (const t of recentTurns) {
      for (const b of detectBadgesForTurn(store, t.id)) {
        const key = `${b.level}:${b.id}`;
        const existing = alertBuckets.get(key);
        if (existing) existing.count += 1;
        else alertBuckets.set(key, { level: b.level, label: b.label, count: 1 });
      }
    }
    const alerts = [...alertBuckets.values()]
      .sort((a, b) => {
        const order = { danger: 0, warn: 1, info: 2 } as Record<string, number>;
        return (order[a.level] ?? 9) - (order[b.level] ?? 9) || b.count - a.count;
      })
      .slice(0, 10);

    // Recent activity: interleave session_start + tool_call events, newest
    // first. Small LIMIT keeps the feed snappy.
    const recentSessions = store.db
      .prepare(
        `SELECT id, agent, workspace_id, started_at
         FROM sessions ORDER BY started_at DESC LIMIT 20`,
      )
      .all() as Array<{
      id: string;
      agent: string;
      workspace_id: string;
      started_at: number;
    }>;
    const recentTools = store.db
      .prepare(
        `SELECT tc.id, tc.tool_name, tc.started_at, t.session_id, s.agent, s.workspace_id
         FROM tool_calls tc
         JOIN turns t ON t.id = tc.turn_id
         JOIN sessions s ON s.id = t.session_id
         ORDER BY tc.started_at DESC LIMIT 30`,
      )
      .all() as Array<{
      id: string;
      tool_name: string;
      started_at: number;
      session_id: string;
      agent: string;
      workspace_id: string;
    }>;
    const recent = [
      ...recentSessions.map((s) => ({
        kind: 'session_start' as const,
        timestamp: s.started_at,
        agent: s.agent,
        session_id: s.id,
        workspace_id: s.workspace_id,
        tool_name: null as string | null,
      })),
      ...recentTools.map((t) => ({
        kind: 'tool_call' as const,
        timestamp: t.started_at,
        agent: t.agent,
        session_id: t.session_id,
        workspace_id: t.workspace_id,
        tool_name: t.tool_name,
      })),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 40);

    return {
      activity,
      activity_total: totalEdits,
      delta_pct,
      top_workspaces: topWorkspaces,
      top_agents: topAgents,
      alerts,
      recent,
    };
  }

  // Peek into quarantined (poison) events so the UI can show a drawer
  // listing what got rejected, instead of just a counter. Returns the
  // newest 50 by default. Each row has just enough metadata to be useful
  // without sending the full event payload (those can be large).
  app.get('/api/queue/poison', async () => {
    const dir = join(getStateDir(), 'queue', '.poison');
    if (!existsSync(dir)) return { events: [] };
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .slice(-50)
      .reverse();
    const events: Array<{
      filename: string;
      size_bytes: number;
      created_at: number;
      type: string | null;
      session_id: string | null;
    }> = [];
    for (const f of files) {
      const path = join(dir, f);
      try {
        const { statSync, readFileSync } = await import('node:fs');
        const st = statSync(path);
        const body = JSON.parse(readFileSync(path, 'utf8')) as {
          type?: string;
          session_id?: string;
        };
        events.push({
          filename: f,
          size_bytes: st.size,
          created_at: st.mtimeMs,
          type: body.type ?? null,
          session_id: body.session_id ?? null,
        });
      } catch {
        events.push({
          filename: f,
          size_bytes: 0,
          created_at: 0,
          type: null,
          session_id: null,
        });
      }
    }
    return { events };
  });

  // Light-weight queue-depth endpoint for the status bar. Reads the on-disk
  // queue directory directly — cheaper than querying state DB. Cached
  // decision: cli writes to <state>/queue/, quarantined files end up in
  // <state>/queue/.poison/. We count *.json files in each.
  app.get('/api/queue-stats', async () => {
    const queueDir = join(getStateDir(), 'queue');
    const poisonDir = join(queueDir, '.poison');
    const count = (dir: string): number => {
      if (!existsSync(dir)) return 0;
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      } catch {
        return 0;
      }
    };
    return { queue: count(queueDir), poisoned: count(poisonDir) };
  });

  app.get('/api/sessions', async () => {
    const rows = store.db
      .prepare(
        `SELECT id, workspace_id, agent, agent_version, started_at, ended_at
         FROM sessions ORDER BY started_at DESC LIMIT 200`,
      )
      .all();
    return { sessions: rows };
  });

  app.get('/api/sessions/:id/files', async (req) => {
    const { id } = req.params as { id: string };
    const rows = store.db
      .prepare(
        `SELECT file_path, COUNT(*) AS edit_count, MIN(created_at) AS first, MAX(created_at) AS last
         FROM edits WHERE session_id = ? GROUP BY file_path ORDER BY last DESC`,
      )
      .all(id);
    return { files: rows };
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = store.deleteSession(id);
    if (!deleted) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { ok: true };
  });

  app.get('/api/turns', async (req) => {
    const { session } = req.query as { session?: string };
    if (!session) return { turns: [] };
    const rows = store.db
      .prepare(
        `SELECT id, session_id, idx, user_prompt, agent_reasoning, agent_final_message, started_at, ended_at
         FROM turns WHERE session_id = ? ORDER BY idx`,
      )
      .all(session);
    return { turns: rows };
  });

  // Flat list of every file touched in a workspace, with edit_count and
  // last_edited timestamp. The UI builds a recursive tree from this.
  // Returning flat keeps the query trivial and leaves the tree layout
  // decision to the UI (collapsed/expanded state, sort order, etc.).
  app.get('/api/workspaces/:path/files', async (req) => {
    const { path: pathParam } = req.params as { path: string };
    const path = decodeURIComponent(pathParam);
    const rows = store.db
      .prepare(
        `SELECT file_path, COUNT(*) AS edit_count, MAX(created_at) AS last_edited,
                COUNT(DISTINCT turn_id) AS touch_count
         FROM edits WHERE workspace_id = ?
         GROUP BY file_path ORDER BY file_path`,
      )
      .all(path) as Array<{
      file_path: string;
      edit_count: number;
      last_edited: number;
      touch_count: number;
    }>;
    return { files: rows };
  });

  app.get('/api/blame', async (req) => {
    const {
      workspace,
      file,
      edit: revisionEditId,
    } = req.query as { workspace?: string; file?: string; edit?: string };
    if (!workspace || !file) {
      return { blame: [], turns: [], content: '', edits: [], chain_broken_edit_ids: [] };
    }
    // Historical revision view (card 51): when `?edit=<id>` is supplied, we
    // replay the edit chain up to that point in-memory instead of reading
    // the live `line_blame` table. The response shape is identical so the
    // UI doesn't branch.
    const historical = revisionEditId
      ? computeBlameAtEdit(store, workspace, file, revisionEditId)
      : null;
    if (revisionEditId && !historical) {
      return { blame: [], turns: [], content: '', edits: [], chain_broken_edit_ids: [] };
    }

    // Enrich blame rows with edit / tool-call metadata. The live path reads
    // directly from line_blame; the historical path hydrates the in-memory
    // rows using a single IN-clause SELECT keyed on edit_id.
    let blame: Array<{
      line_no: number;
      content_hash: string;
      edit_id: string;
      turn_id: string;
      session_id: string | null;
      created_at: number | null;
      tool_call_id: string | null;
      tool_name: string | null;
      tool_call_explanation: string | null;
    }>;
    if (historical) {
      const editIds = Array.from(new Set(historical.blame.map((b) => b.edit_id)));
      const metaRows =
        editIds.length === 0
          ? []
          : (store.db
              .prepare(
                `SELECT e.id AS edit_id, e.session_id, e.created_at,
                        tc.id AS tool_call_id, tc.tool_name,
                        tc.explanation AS tool_call_explanation
                 FROM edits e LEFT JOIN tool_calls tc ON tc.id = e.tool_call_id
                 WHERE e.id IN (${editIds.map(() => '?').join(',')})`,
              )
              .all(...editIds) as Array<{
              edit_id: string;
              session_id: string;
              created_at: number;
              tool_call_id: string | null;
              tool_name: string | null;
              tool_call_explanation: string | null;
            }>);
      const metaByEdit = new Map(metaRows.map((r) => [r.edit_id, r] as const));
      blame = historical.blame.map((b) => {
        const m = metaByEdit.get(b.edit_id);
        return {
          line_no: b.line_no,
          content_hash: b.content_hash,
          edit_id: b.edit_id,
          turn_id: b.turn_id,
          session_id: m?.session_id ?? null,
          created_at: m?.created_at ?? null,
          tool_call_id: m?.tool_call_id ?? null,
          tool_name: m?.tool_name ?? null,
          tool_call_explanation: m?.tool_call_explanation ?? null,
        };
      });
    } else {
      blame = store.db
        .prepare(
          `SELECT b.line_no, b.content_hash, b.edit_id, b.turn_id,
                  e.session_id, e.created_at,
                  tc.id AS tool_call_id, tc.tool_name, tc.explanation AS tool_call_explanation
           FROM line_blame b
           LEFT JOIN edits e ON e.id = b.edit_id
           LEFT JOIN tool_calls tc ON tc.id = e.tool_call_id
           WHERE b.workspace_id = ? AND b.file_path = ? ORDER BY b.line_no`,
        )
        .all(workspace, file) as typeof blame;
    }
    // Distinct turn ids → fetch prompts so UI can label/colour them.
    const turnIds = Array.from(
      new Set((blame as Array<{ turn_id: string }>).map((b) => b.turn_id)),
    );
    const turns =
      turnIds.length === 0
        ? []
        : (store.db
            .prepare(
              `SELECT id, session_id, idx, user_prompt, agent_reasoning, agent_final_message, started_at
               FROM turns WHERE id IN (${turnIds.map(() => '?').join(',')})`,
            )
            .all(...turnIds) as Array<{
            id: string;
            session_id: string;
            idx: number;
            user_prompt: string;
            agent_reasoning: string | null;
            agent_final_message: string | null;
            started_at: number;
          }>);

    // Edit chain (for chain-break detection + Inspector's "other turns" list).
    const editsChain = store.db
      .prepare(
        `SELECT e.id, e.turn_id, e.session_id, e.before_hash, e.after_hash, e.created_at,
                (SELECT COUNT(*) FROM hunks h WHERE h.edit_id = e.id) AS hunk_count
         FROM edits e WHERE e.workspace_id = ? AND e.file_path = ?
         ORDER BY e.created_at`,
      )
      .all(workspace, file) as Array<{
      id: string;
      turn_id: string;
      session_id: string;
      before_hash: string | null;
      after_hash: string;
      created_at: number;
      hunk_count: number;
    }>;
    // Chain break: an edit whose before_hash doesn't match the previous
    // edit's after_hash means the user (or another non-captured actor)
    // modified the file between AI edits. Flag those edit IDs so the UI
    // can paint a warning marker on the lines they wrote.
    // (Historical path already produced its own list; reuse it.)
    let chain_broken_edit_ids: string[];
    if (historical) {
      chain_broken_edit_ids = historical.chain_broken_edit_ids;
    } else {
      chain_broken_edit_ids = [];
      for (let i = 1; i < editsChain.length; i++) {
        const prev = editsChain[i - 1];
        const cur = editsChain[i];
        if (prev && cur && cur.before_hash !== prev.after_hash) {
          chain_broken_edit_ids.push(cur.id);
        }
      }
    }

    // Content: the historical path already pinned this to the target
    // revision's after blob. The live path walks back to the last edit and
    // reuses the same blob lookup.
    let content = '';
    if (historical) {
      content = historical.content;
    } else {
      const last = editsChain[editsChain.length - 1];
      if (last) {
        const blob = store.db
          .prepare('SELECT content FROM blobs WHERE hash = ?')
          .get(last.after_hash) as { content: Buffer } | undefined;
        if (blob) content = blob.content.toString('utf8');
      }
    }
    return { blame, turns, content, edits: editsChain, chain_broken_edit_ids };
  });

  app.get('/api/review', async (req) => {
    const { session } = req.query as { session?: string };
    if (!session) return { turns: [] };
    const sess = store.db.prepare('SELECT agent FROM sessions WHERE id = ?').get(session) as
      | { agent: string }
      | undefined;
    const turns = store.db
      .prepare(
        `SELECT id, idx, user_prompt, agent_reasoning, agent_final_message, started_at, ended_at
         FROM turns WHERE session_id = ? ORDER BY idx`,
      )
      .all(session) as Array<{ id: string }>;
    const getEdits = store.db.prepare(
      `SELECT e.id, e.file_path, e.before_hash, e.after_hash, e.git_head,
              tc.id AS tool_call_id, tc.tool_name, tc.explanation AS tool_call_explanation
       FROM edits e LEFT JOIN tool_calls tc ON tc.id = e.tool_call_id
       WHERE e.turn_id = ?`,
    );
    const getHunks = store.db.prepare(
      'SELECT new_start, new_count, old_text, new_text, explanation FROM hunks WHERE edit_id = ?',
    );
    const enriched = turns.map((t) => ({
      ...(t as unknown as Record<string, unknown>),
      edits: (getEdits.all(t.id) as Array<{ id: string }>).map((e) => ({
        ...(e as unknown as Record<string, unknown>),
        hunks: getHunks.all(e.id),
      })),
      badges: detectBadgesForTurn(store, t.id),
    }));
    return { agent: sess?.agent ?? null, turns: enriched };
  });

  app.get('/api/ast', async (req) => {
    const { workspace, file } = req.query as { workspace?: string; file?: string };
    if (!workspace || !file) return { nodes: [] };
    const nodes = store.db
      .prepare(
        `SELECT id, kind, qualified_name, start_line, end_line
         FROM ast_nodes WHERE workspace_id = ? AND file_path = ?`,
      )
      .all(workspace, file);
    return { nodes };
  });

  // Raw blob content — used by `minspect revert` to restore files to an
  // earlier state. text/plain with the sha256 in ETag so clients can cache.
  app.get('/api/blobs/:hash', async (req, reply) => {
    const { hash } = req.params as { hash: string };
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      reply.code(400);
      return { error: 'invalid_hash' };
    }
    const row = store.db.prepare('SELECT content FROM blobs WHERE hash = ?').get(hash) as
      | { content: Buffer }
      | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.header('content-type', 'text/plain; charset=utf-8');
    reply.header('etag', hash);
    return row.content.toString('utf8');
  });

  // Revert plan — for a turn or a single edit, compute:
  //   files[]: per file, the before_hash we'd restore TO, and the after_hash
  //            we expect the disk to currently hold.
  //   warnings: codex_source (hard block), chain_broken_user_edits (user edits
  //            between target and now that would be overwritten), and
  //            later_edits_will_be_lost (AI edits on the same files after the
  //            target turn/edit — reverting undoes them too).
  app.get('/api/revert/plan', async (req, reply) => {
    const { turn, edit } = req.query as { turn?: string; edit?: string };
    if ((turn && edit) || (!turn && !edit)) {
      reply.code(400);
      return { error: 'specify_turn_or_edit' };
    }

    interface EditRow {
      id: string;
      turn_id: string;
      session_id: string;
      workspace_id: string;
      file_path: string;
      before_hash: string | null;
      after_hash: string;
      created_at: number;
    }

    let targetEdits: EditRow[];
    let targetKind: 'turn' | 'edit';
    let targetId: string;
    if (turn) {
      targetKind = 'turn';
      targetId = turn;
      targetEdits = store.db
        .prepare(
          `SELECT id, turn_id, session_id, workspace_id, file_path, before_hash, after_hash, created_at
           FROM edits WHERE turn_id = ? ORDER BY created_at`,
        )
        .all(turn) as EditRow[];
    } else {
      targetKind = 'edit';
      targetId = edit as string;
      targetEdits = store.db
        .prepare(
          `SELECT id, turn_id, session_id, workspace_id, file_path, before_hash, after_hash, created_at
           FROM edits WHERE id = ?`,
        )
        .all(edit) as EditRow[];
    }
    if (targetEdits.length === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const sessionId = targetEdits[0]?.session_id ?? '';
    const sess = store.db.prepare('SELECT agent FROM sessions WHERE id = ?').get(sessionId) as
      | { agent: string }
      | undefined;
    const source_agent = sess?.agent ?? null;

    // Collapse per file: earliest before_hash (what to restore TO), latest
    // after_hash (what AI left it at end of target). kind = delete when AI
    // created the file in this turn (earliest before_hash is NULL).
    const byFile = new Map<
      string,
      {
        file_path: string;
        workspace_id: string;
        before_hash: string | null;
        after_hash: string;
        earliest_created_at: number;
        latest_created_at: number;
      }
    >();
    for (const e of targetEdits) {
      const cur = byFile.get(e.file_path);
      if (!cur) {
        byFile.set(e.file_path, {
          file_path: e.file_path,
          workspace_id: e.workspace_id,
          before_hash: e.before_hash,
          after_hash: e.after_hash,
          earliest_created_at: e.created_at,
          latest_created_at: e.created_at,
        });
      } else {
        if (e.created_at < cur.earliest_created_at) {
          cur.earliest_created_at = e.created_at;
          cur.before_hash = e.before_hash;
        }
        if (e.created_at > cur.latest_created_at) {
          cur.latest_created_at = e.created_at;
          cur.after_hash = e.after_hash;
        }
      }
    }

    const getLaterEdits = store.db.prepare(
      `SELECT e.id, e.turn_id, e.before_hash, e.after_hash, e.created_at, t.idx AS turn_idx
       FROM edits e LEFT JOIN turns t ON t.id = e.turn_id
       WHERE e.workspace_id = ? AND e.file_path = ? AND e.created_at > ?
       ORDER BY e.created_at`,
    );
    const getExpectedCurrent = store.db.prepare(
      `SELECT after_hash FROM edits
       WHERE workspace_id = ? AND file_path = ?
       ORDER BY created_at DESC LIMIT 1`,
    );

    const files = [];
    const laterLost: Array<{
      file_path: string;
      edit_id: string;
      turn_id: string;
      turn_idx: number | null;
    }> = [];
    const chainBroken: Array<{ file_path: string; at_edit_id: string }> = [];

    for (const f of byFile.values()) {
      const expected = getExpectedCurrent.get(f.workspace_id, f.file_path) as
        | { after_hash: string }
        | undefined;
      const later = getLaterEdits.all(f.workspace_id, f.file_path, f.latest_created_at) as Array<{
        id: string;
        turn_id: string;
        before_hash: string | null;
        after_hash: string;
        created_at: number;
        turn_idx: number | null;
      }>;
      // Detect chain breaks in the later edits: if any later edit's
      // before_hash doesn't match the prior edit's after_hash, a user edit
      // happened in between.
      let priorAfter = f.after_hash;
      for (const l of later) {
        if (l.before_hash !== priorAfter) {
          chainBroken.push({ file_path: f.file_path, at_edit_id: l.id });
        }
        priorAfter = l.after_hash;
        laterLost.push({
          file_path: f.file_path,
          edit_id: l.id,
          turn_id: l.turn_id,
          turn_idx: l.turn_idx,
        });
      }
      files.push({
        file_path: f.file_path,
        workspace_id: f.workspace_id,
        before_hash: f.before_hash,
        after_hash: f.after_hash,
        expected_current_hash: expected?.after_hash ?? f.after_hash,
        kind: f.before_hash === null ? 'delete' : 'restore',
      });
    }

    return {
      target_kind: targetKind,
      target_id: targetId,
      source_agent,
      files,
      warnings: {
        codex_source: source_agent === 'codex',
        chain_broken_user_edits: chainBroken,
        later_edits_will_be_lost: laterLost,
      },
    };
  });

  // UI "refresh/sync" button target. Fires three subcommands in the
  // collector's own process context:
  //   1. minspect install --agent claude-code --scope user
  //   2. minspect install --agent opencode    --scope user
  //   3. minspect import-codex --all --since 30d
  // Returns 200 with per-step outcome (never 5xx so the UI can show
  // whichever step succeeded). 409 if a refresh is already in-flight.
  app.post('/api/refresh', async (_req, reply) => {
    if (isRefreshRunning()) {
      reply.code(409);
      return { error: 'refresh_already_running' };
    }
    try {
      const result = await runRefresh();
      return result;
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });

  // Card 33: cross-session search via SQLite FTS5. Query shape:
  //   GET /api/search?q=<text>&limit=20
  // Returns `{fts_available, results: [{kind, source_id, session_id,
  //   workspace_id, snippet}]}`. When FTS is unavailable, `fts_available =
  //   false` and `results = []` (UI prompts user to rebuild DB rather than
  //   silently degrading to a LIKE scan — keeping the code path simple).
  app.get('/api/search', async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const query = (q ?? '').trim();
    const lim = Math.min(Math.max(Number.parseInt(limit ?? '20', 10) || 20, 1), 100);
    if (!store.ftsEnabled) return { fts_available: false, results: [] };
    if (!query) return { fts_available: true, results: [] };

    // Sanitize: strip punctuation (the MATCH parser fails on stray quotes /
    // parens) except `.` and `/` so file-path tokens survive. Lowercase +
    // drop AND/OR/NOT/NEAR — FTS5 treats those in uppercase as operators
    // and in lowercase as ordinary words, but either way the user usually
    // types them as filler ("foo AND bar"). Whitespace-separated remaining
    // terms are implicitly AND-connected by FTS5; add a `*` suffix so the
    // palette is forgiving as the user types.
    const STOPWORDS = new Set(['and', 'or', 'not', 'near', 'the', 'a', 'an']);
    const tokens = query
      .toLowerCase()
      .replace(/[^\w./ ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t))
      .slice(0, 8);
    if (tokens.length === 0) return { fts_available: true, results: [] };
    const matchExpr = tokens.map((t) => `${t}*`).join(' ');

    interface Row {
      kind: string;
      source_id: string;
      session_id: string;
      workspace_id: string;
      content: string;
      snippet: string;
    }
    let rows: Row[];
    try {
      rows = store.db
        .prepare(
          `SELECT kind, source_id, session_id, workspace_id, content,
                  snippet(search_index, 4, '<mark>', '</mark>', '…', 10) AS snippet
           FROM search_index
           WHERE search_index MATCH ?
           ORDER BY bm25(search_index)
           LIMIT ?`,
        )
        .all(matchExpr, lim) as Row[];
    } catch {
      // Malformed FTS5 query syntax (e.g. unbalanced quotes after sanitize).
      rows = [];
    }
    return { fts_available: true, query: matchExpr, results: rows };
  });
}
