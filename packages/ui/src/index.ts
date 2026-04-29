import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = '@minspect/ui';

// First 12 chars of the sha256 of dist/spa/index.html. The UI bundle's
// entry script name contains a content hash already, so any meaningful
// change flips this. Collector exposes it via /api/build-info and the
// running SPA compares against its own compile-time constant so it can
// warn when stale.
export function getBuildHash(): string {
  try {
    const html = getAppHtml();
    return createHash('sha256').update(html).digest('hex').slice(0, 12);
  } catch {
    return 'unbuilt';
  }
}

// When bundled into the published `minspect` npm package (card 46), the
// CLI sets MINSPECT_UI_DIR to point at the copied SPA next to bin.cjs.
// Honor it first; everything else is workspace-tree fallback.
function resolveSpaDir(): string[] {
  const envOverride = process.env.MINSPECT_UI_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    ...(envOverride ? [envOverride] : []),
    resolve(here, 'spa'), // built (dist/spa/)
    resolve(here, '..', 'dist', 'spa'), // when imported before copy
  ];
}

// Return the React SPA shell (produced by `vite build`). The collector
// serves this at GET /. The file is a Vite-generated index.html that
// bootstraps the bundled JS/CSS from ./spa/assets/.
export function getAppHtml(): string {
  for (const dir of resolveSpaDir()) {
    try {
      return readFileSync(resolve(dir, 'index.html'), 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error('UI not built: run `pnpm -C packages/ui build`');
}

// Absolute path to the dist/spa directory (for @fastify/static roots or
// manual asset serving). Throws if the directory isn't built yet.
export function getAppAssetsDir(): string {
  for (const dir of resolveSpaDir()) {
    try {
      readFileSync(resolve(dir, 'index.html'));
      return dir;
    } catch {
      /* try next */
    }
  }
  // Fall back to the first candidate so error messages surface a sensible
  // path rather than throwing on getAppAssetsDir() itself.
  return resolveSpaDir()[0] ?? '';
}
