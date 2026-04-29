import type { Store } from './store.js';

export type BadgeLevel = 'info' | 'warn' | 'danger';

export interface Badge {
  id: string; // detector id
  label: string;
  level: BadgeLevel;
  detail?: string;
}

export interface DetectorConfig {
  enabled: boolean;
  security_globs: string[]; // simple prefix match
  oversized_lines: number;
  oversized_files: number;
  dep_files: string[];
}

const DEFAULT_CONFIG: DetectorConfig = {
  enabled: true,
  security_globs: ['auth/', 'crypto/', 'secrets/', 'security/'],
  oversized_lines: 500,
  oversized_files: 10,
  dep_files: ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml'],
};

interface TurnContext {
  turn_id: string;
  edits: Array<{ file_path: string; before_content: string | null; after_content: string }>;
  hunks_total_new_lines: number;
}

function loadTurnContext(store: Store, turnId: string): TurnContext {
  const edits = store.db
    .prepare(
      `SELECT e.id, e.file_path, e.before_hash, e.after_hash
       FROM edits e WHERE e.turn_id = ?`,
    )
    .all(turnId) as Array<{
    id: string;
    file_path: string;
    before_hash: string | null;
    after_hash: string;
  }>;

  const getBlob = store.db.prepare('SELECT content FROM blobs WHERE hash = ?');
  const enriched = edits.map((e) => {
    const before =
      e.before_hash === null
        ? null
        : ((getBlob.get(e.before_hash) as { content: Buffer } | undefined)?.content?.toString(
            'utf8',
          ) ?? null);
    const after =
      (getBlob.get(e.after_hash) as { content: Buffer } | undefined)?.content?.toString('utf8') ??
      '';
    return { file_path: e.file_path, before_content: before, after_content: after };
  });

  const hunks = store.db
    .prepare(
      `SELECT SUM(new_count) AS total FROM hunks h
       JOIN edits e ON e.id = h.edit_id
       WHERE e.turn_id = ?`,
    )
    .get(turnId) as { total: number | null };

  return { turn_id: turnId, edits: enriched, hunks_total_new_lines: hunks.total ?? 0 };
}

type Detector = (ctx: TurnContext, cfg: DetectorConfig) => Badge | null;

// 1. code + tests modified together — informational
const codeAndTests: Detector = (ctx): Badge | null => {
  const testish = /\btest\b|\.test\.|\.spec\.|__tests?__|\/tests\//i;
  const hasTests = ctx.edits.some((e) => testish.test(e.file_path));
  const hasCode = ctx.edits.some((e) => !testish.test(e.file_path));
  if (hasTests && hasCode) {
    return { id: 'code-and-tests-same-turn', label: 'code + tests', level: 'info' };
  }
  return null;
};

// 2. new dependency added
const newDep: Detector = (ctx, cfg): Badge | null => {
  const depEdit = ctx.edits.find((e) =>
    cfg.dep_files.some((f) => e.file_path.endsWith(f) || e.file_path.endsWith(`/${f}`)),
  );
  if (!depEdit) return null;
  const before = depEdit.before_content ?? '';
  const after = depEdit.after_content;
  // naive: any new line starting with `"` in before-after diff suggests added entry
  const beforeLines = new Set(before.split('\n'));
  const added = after
    .split('\n')
    .filter((l) => !beforeLines.has(l) && /["']?[\w@/.-]+["']?\s*[:=]/.test(l));
  if (added.length > 0) {
    return {
      id: 'new-dependency',
      label: 'new dependency',
      level: 'warn',
      detail: `${depEdit.file_path} gained ${added.length} line(s)`,
    };
  }
  return null;
};

// 3. security-sensitive path
const security: Detector = (ctx, cfg): Badge | null => {
  const hit = ctx.edits.find((e) => cfg.security_globs.some((g) => e.file_path.includes(g)));
  if (hit) {
    return {
      id: 'security-sensitive-path',
      label: 'security-sensitive',
      level: 'danger',
      detail: hit.file_path,
    };
  }
  return null;
};

// 4. oversized turn
const oversized: Detector = (ctx, cfg): Badge | null => {
  if (ctx.hunks_total_new_lines > cfg.oversized_lines || ctx.edits.length > cfg.oversized_files) {
    return {
      id: 'oversized-turn',
      label: 'oversized turn',
      level: 'warn',
      detail: `${ctx.edits.length} file(s), ${ctx.hunks_total_new_lines} line(s)`,
    };
  }
  return null;
};

// 5. tests-only (informational)
const testsOnly: Detector = (ctx): Badge | null => {
  if (ctx.edits.length === 0) return null;
  const testish = /\btest\b|\.test\.|\.spec\.|__tests?__|\/tests\//i;
  if (ctx.edits.every((e) => testish.test(e.file_path))) {
    return { id: 'tests-only', label: 'tests only', level: 'info' };
  }
  return null;
};

const ALL_DETECTORS: Array<[string, Detector]> = [
  ['code-and-tests-same-turn', codeAndTests],
  ['new-dependency', newDep],
  ['security-sensitive-path', security],
  ['oversized-turn', oversized],
  ['tests-only', testsOnly],
];

export function detectBadgesForTurn(
  store: Store,
  turnId: string,
  config: Partial<DetectorConfig> = {},
): Badge[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return [];
  const ctx = loadTurnContext(store, turnId);
  const badges: Badge[] = [];
  for (const [_, d] of ALL_DETECTORS) {
    const b = d(ctx, cfg);
    if (b) badges.push(b);
  }
  return badges;
}
