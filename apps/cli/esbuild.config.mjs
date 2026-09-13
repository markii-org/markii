/**
 * Two bundles, one build script, modelled on `apps/vscode/esbuild.config.mjs`:
 *
 *   1. `dist/markii.js` — the CLI entry (`src/main.ts`). Platform `node`,
 *      format `cjs`, everything bundled in, with a `#!/usr/bin/env node`
 *      banner and made executable (0o755) after every build so the `bin`
 *      entry in `package.json` runs directly.
 *   2. `dist/run/worker.js` — the `worker_thread` entry for the shared Run
 *      path (`@markii/host`'s `src/run/worker-entry.ts`), exactly like the
 *      VS Code extension's own worker bundle. `dist/run/glue.wasm` is
 *      copied next to it (wasmoon's real WASM binary, which cannot be
 *      bundled into JS source).
 *
 * No `esbuild-wasm` copy here: the CLI loads no packs and carries no pack
 * compiler (see AGENTS.md's Host positioning and this app's own README).
 *
 * `@markii/*` resolves to each package's `src/`, exactly like
 * `scripts/workspace-aliases.config.ts` does for Vite/Vitest and like
 * `apps/vscode/esbuild.config.mjs` does for that extension. That map is
 * TypeScript and this file is plain ESM run by node, so the roots are
 * repeated here; keep this in sync with the other two when a package is
 * added.
 */
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Package name -> that package's `src` directory (see the note above). */
const markiiSrcRoots = {
  '@markii/core': path.join(repoRoot, 'packages', 'markii-core', 'src'),
  '@markii/bundle': path.join(repoRoot, 'packages', 'markii-bundle', 'src'),
  '@markii/stdlib': path.join(repoRoot, 'packages', 'markii-stdlib', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
  '@markii/ansi': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-ansi',
    'src',
  ),
  '@markii/html': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-html',
    'src',
  ),
  '@markii/host': path.join(repoRoot, 'packages', 'markii-host', 'src'),
};

const args = new Set(process.argv.slice(2));
const production = args.has('--production');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  logLevel: 'info',
  minify: production,
  sourcemap: production ? false : 'inline',
  alias: markiiSrcRoots,
};

const cliVersion = JSON.parse(
  readFileSync(path.join(here, 'package.json'), 'utf8'),
).version;

/** @type {import('esbuild').BuildOptions} */
const cliBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(here, 'dist', 'markii.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: [],
  banner: { js: '#!/usr/bin/env node' },
  define: {
    'process.env.MARKII_CLI_VERSION': JSON.stringify(cliVersion),
  },
  // `@markii/host`'s `src/packs/pack-build.ts` references `import.meta.url`
  // (guarded by a `typeof require` runtime check) purely for the ESM/dev
  // half of that check; the CJS half this build produces never evaluates
  // it. The CLI never imports that module directly, but it is reachable
  // transitively through `@markii/host`'s main entry, so the same silencing
  // `apps/vscode/esbuild.config.mjs` applies is needed here too.
  logOverride: { 'empty-import-meta': 'silent' },
};

/** @type {import('esbuild').BuildOptions} */
const workerBuild = {
  ...shared,
  entryPoints: [
    path.join(
      repoRoot,
      'packages',
      'markii-host',
      'src',
      'run',
      'worker-entry.ts',
    ),
  ],
  outfile: path.join(here, 'dist', 'run', 'worker.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Spawned by file path via `worker_threads`, never `require`d — nothing
  // needs to be external here.
  external: [],
};

const workerOutDir = path.join(here, 'dist', 'run');

/**
 * Copies wasmoon's `glue.wasm` next to the compiled worker bundle, exactly
 * like `apps/vscode/esbuild.config.mjs`'s `copyWasmGlue`. Plain
 * `node_modules` resolution: this repo hoists `wasmoon` to the root.
 */
function copyWasmGlue() {
  mkdirSync(workerOutDir, { recursive: true });
  const source = path.join(
    repoRoot,
    'node_modules',
    'wasmoon',
    'dist',
    'glue.wasm',
  );
  const dest = path.join(workerOutDir, 'glue.wasm');
  copyFileSync(source, dest);
}

/** Makes `dist/markii.js` executable so the `bin` entry runs directly. */
function makeExecutable() {
  chmodSync(path.join(here, 'dist', 'markii.js'), 0o755);
}

await Promise.all([build(cliBuild), build(workerBuild)]);
copyWasmGlue();
makeExecutable();
