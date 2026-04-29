// Bundle the CLI + all workspace dependencies into a single self-contained
// `dist-bundle/` tarball-ready directory. Produces:
//
//   dist-bundle/
//     package.json           (public-facing, name: "@ivenlau/minspect")
//     bin.cjs                (bundled entry, shebang preserved)
//     ui/                    (UI SPA static assets, copied from @minspect/ui)
//     README.md              (copy of project README)
//
// Consumers run `npm i -g @ivenlau/minspect` and get all of the above. Native modules
// (`better-sqlite3`, tree-sitter*) stay external so npm install can fetch
// prebuilt binaries for the user's platform. Everything else — commander,
// fastify, the core/collector/adapters TypeScript — is bundled inline.
//
// Invariants the `pack.test.ts` asserts:
//   - dist-bundle/package.json has name: "@ivenlau/minspect"
//   - bin.cjs starts with `#!/usr/bin/env node`
//   - ui/index.html exists (the SPA was copied)
//   - Every `@minspect/*` import is bundled (tarball has zero workspace deps)

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..');
const REPO_ROOT = join(CLI_ROOT, '..', '..');
const OUT = join(CLI_ROOT, 'dist-bundle');

// Native modules that must be resolved at install time (prebuilt binaries).
// Leaving them out of the bundle means the consumer's `npm i` triggers
// prebuild-install / node-gyp and gets a platform-appropriate copy.
const NATIVE_EXTERNAL = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-rust',
  'tree-sitter-typescript',
  // node: protocol modules are always external in ESM-to-CJS bundles.
  'node:*',
];

// Pull the CLI's current workspace version — we publish under the same
// number so the global vs workspace packages can't drift visibly.
const cliPkg = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
const VERSION = cliPkg.version;

function fresh(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

async function bundleBin() {
  const result = await build({
    entryPoints: [join(CLI_ROOT, 'src', 'bin.ts')],
    outfile: join(OUT, 'bin.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Needed so esbuild rewrites TS imports through the workspace packages'
    // `exports` maps (which point at `dist/index.js` etc.).
    conditions: ['import', 'node'],
    external: NATIVE_EXTERNAL,
    // CJS bundles don't have `import.meta`, so every workspace file that
    // does `fileURLToPath(import.meta.url)` to find its own path breaks.
    // Alias `import.meta.url` to a banner-declared constant that's the
    // bundle's own file:// URL. Source files that used their own location
    // to find sibling dist dirs now find the bundle instead — the bundler
    // has already inlined those siblings, so relative resolution is moot.
    // (UI assets get located via MINSPECT_UI_DIR env, set by bin.cjs.)
    define: {
      'import.meta.url': '__importMetaUrl',
    },
    // Source file (src/bin.ts) already has #!/usr/bin/env node — esbuild
    // hoists it to line 1 of the output. Don't duplicate it here.
    banner: {
      js: [
        "const __importMetaUrl = require('node:url').pathToFileURL(__filename).toString();",
        // Tell @minspect/ui where to find the SPA assets we copied alongside
        // this bundle. getAppAssetsDir() / getAppHtml() consult this env
        // var first before falling back to their source-tree resolution.
        "process.env.MINSPECT_UI_DIR ||= require('node:path').join(require('node:path').dirname(__filename), 'ui');",
      ].join('\n'),
    },
    sourcemap: false,
    minify: false, // keep stack traces readable
    // Resolve workspace package sources via their built dist — we run this
    // after `pnpm -r build`, so everything's already compiled.
    mainFields: ['module', 'main'],
  });
  if (result.errors.length > 0) {
    throw new Error(`esbuild errors: ${JSON.stringify(result.errors, null, 2)}`);
  }
}

function copyUi() {
  const uiDist = join(REPO_ROOT, 'packages', 'ui', 'dist', 'spa');
  if (!existsSync(uiDist)) {
    throw new Error(`UI dist not found at ${uiDist}. Run \`pnpm -C packages/ui build\` first.`);
  }
  const target = join(OUT, 'ui');
  mkdirSync(target, { recursive: true });
  cpSync(uiDist, target, { recursive: true });
}

function writeBundledPackageJson() {
  // Flat, publish-ready metadata. No workspace deps — everything is bundled
  // except NATIVE_EXTERNAL, which users get via `npm i`.
  const nativeDeps = {
    'better-sqlite3': '^11.7.0',
    'tree-sitter': '^0.22.4',
    'tree-sitter-go': '^0.23.4',
    'tree-sitter-java': '^0.23.5',
    'tree-sitter-javascript': '^0.23.1',
    'tree-sitter-python': '^0.23.6',
    'tree-sitter-rust': '^0.23.2',
    'tree-sitter-typescript': '^0.23.2',
  };
  const pub = {
    name: '@ivenlau/minspect',
    version: VERSION,
    description:
      'Git blame for AI coding agents — record what every agent changed, why, and through which prompts, down to the line.',
    bin: { minspect: './bin.cjs' },
    files: ['bin.cjs', 'ui/**', 'README.md'],
    engines: { node: '>=20' },
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/ivenlau/minspect',
    },
    publishConfig: { access: 'public' },
    dependencies: nativeDeps,
  };
  writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(pub, null, 2)}\n`);
}

function copyReadme() {
  const src = join(REPO_ROOT, 'README.md');
  if (existsSync(src)) copyFileSync(src, join(OUT, 'README.md'));
}

async function main() {
  const uiDistPresent = existsSync(join(REPO_ROOT, 'packages', 'ui', 'dist', 'spa'));
  const collectorDistPresent = existsSync(
    join(REPO_ROOT, 'packages', 'collector', 'dist', 'index.js'),
  );
  if (!uiDistPresent || !collectorDistPresent) {
    throw new Error(
      'workspace not built — run `pnpm -r build` before `pnpm -C packages/cli bundle`',
    );
  }

  fresh(OUT);
  await bundleBin();
  copyUi();
  writeBundledPackageJson();
  copyReadme();
  // eslint-disable-next-line no-console
  console.log(`bundled ${OUT}`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
