import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Store, getDbPath, getStateDir } from '@minspect/collector';

export interface VacuumOptions {
  stateRoot?: string;
  fix?: boolean;
  clearPoison?: boolean;
  // Test/smoke hook — when set, skip the "daemon is running" preflight that
  // otherwise prevents us from concurrently opening the SQLite file.
  allowOnlineTest?: boolean;
}

export interface VacuumResult {
  orphan_blame_rows: number;
  orphan_blobs: number;
  poison_events: number;
  removed: {
    orphan_blame: number;
    orphan_blobs: number;
    poison: number;
  };
  mode: 'dry-run' | 'fix';
}

// `minspect vacuum` — data hygiene helper. Scans for orphan line_blame
// rows (turn_id pointing at a turn that no longer exists — residue from
// the early poison-queue incident) and quarantined events in
// `<state>/queue/.poison/`. Default is dry-run; `--fix` / `--clear-poison`
// actually remove things.
export async function runVacuum(options: VacuumOptions = {}): Promise<VacuumResult> {
  const stateRoot = options.stateRoot ?? getStateDir();
  const poisonDir = join(stateRoot, 'queue', '.poison');
  const poisonFiles = existsSync(poisonDir)
    ? readdirSync(poisonDir).filter((f) => f.endsWith('.json'))
    : [];

  const dbPath = getDbPath(stateRoot);
  let orphanBlameCount = 0;
  let orphanBlobsCount = 0;
  let removedOrphanBlame = 0;
  let removedOrphanBlobs = 0;
  if (existsSync(dbPath)) {
    // SQLite allows concurrent readers; a running daemon doesn't block
    // read queries. For writes the `.db-wal` journal serialises us.
    const store = new Store(dbPath);
    try {
      orphanBlameCount = (
        store.db
          .prepare(
            'SELECT COUNT(*) AS n FROM line_blame WHERE turn_id NOT IN (SELECT id FROM turns)',
          )
          .get() as { n: number }
      ).n;
      orphanBlobsCount = (
        store.db
          .prepare(
            `SELECT COUNT(*) AS n FROM blobs b
             WHERE NOT EXISTS (SELECT 1 FROM edits e WHERE e.before_hash = b.hash OR e.after_hash = b.hash)`,
          )
          .get() as { n: number }
      ).n;

      if (options.fix) {
        const before = store.db
          .prepare('DELETE FROM line_blame WHERE turn_id NOT IN (SELECT id FROM turns)')
          .run();
        removedOrphanBlame = before.changes;
        const afterBlobs = store.db
          .prepare(
            `DELETE FROM blobs
             WHERE NOT EXISTS (SELECT 1 FROM edits e WHERE e.before_hash = blobs.hash OR e.after_hash = blobs.hash)`,
          )
          .run();
        removedOrphanBlobs = afterBlobs.changes;
      }
    } finally {
      store.close();
    }
  }

  let removedPoison = 0;
  if (options.clearPoison && poisonFiles.length > 0) {
    for (const f of poisonFiles) {
      try {
        rmSync(join(poisonDir, f));
        removedPoison++;
      } catch {
        /* ignore */
      }
    }
  }

  return {
    orphan_blame_rows: orphanBlameCount,
    orphan_blobs: orphanBlobsCount,
    poison_events: poisonFiles.length,
    removed: {
      orphan_blame: removedOrphanBlame,
      orphan_blobs: removedOrphanBlobs,
      poison: removedPoison,
    },
    mode: options.fix || options.clearPoison ? 'fix' : 'dry-run',
  };
}

// Read a small preview of quarantined events — used by the UI drawer.
export interface PoisonPreview {
  filename: string;
  size_bytes: number;
  created_at: number;
  type: string | null;
  session_id: string | null;
}

export function listPoison(stateRoot?: string, limit = 50): PoisonPreview[] {
  const dir = join(stateRoot ?? getStateDir(), 'queue', '.poison');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(-limit)
    .reverse();
  const out: PoisonPreview[] = [];
  for (const f of files) {
    const path = join(dir, f);
    try {
      const st = statSync(path);
      const body = JSON.parse(readFileSync(path, 'utf8')) as {
        type?: string;
        session_id?: string;
      };
      out.push({
        filename: f,
        size_bytes: st.size,
        created_at: st.mtimeMs,
        type: body.type ?? null,
        session_id: body.session_id ?? null,
      });
    } catch {
      // corrupt file — still surface the filename so the user can see it.
      out.push({
        filename: f,
        size_bytes: 0,
        created_at: 0,
        type: null,
        session_id: null,
      });
    }
  }
  return out;
}
