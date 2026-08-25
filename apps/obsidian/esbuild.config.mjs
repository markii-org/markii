/**
 * Two bundles, one build script:
 *
 *   1. `dist/main.js`   — Obsidian expects a plugin's entry to be named
 *      exactly `main.js` sitting directly in its plugin folder alongside
 *      `manifest.json` and `styles.css` — but that plugin folder is the
 *      *installed* location inside a vault
 *      (`<vault>/.obsidian/plugins/markii/`), not this workspace directory
 *      itself. Building to `dist/` (rather than dropping `main.js` at the
 *      workspace root) keeps the generated bundle covered by the repo's
 *      existing `dist/` ignore/lint-exclusion patterns, the same way every
 *      other workspace's build output already is; the manual-install steps
 *      (see the task report) copy `manifest.json`, `styles.css`, and every
 *      file under `dist/` into that plugin folder. Format `cjs` (Obsidian
 *      loads a plugin's `main.js` the same way VS Code loads an extension's
 *      `main`, via `require`), platform `browser` (the plugin runs inside
 *      Obsidian's renderer process, not a plain Node host), with `obsidian`
 *      and Electron/Node builtins marked external — Obsidian injects
 *      `obsidian` itself at runtime, and Electron's own built-ins (plus
 *      `node:worker_threads`, which `@markii/host`'s `spawnRun` uses
 *      directly — Obsidian desktop's renderer runs with Node integration,
 *      exactly like the other Node builtins this bundle already externalizes)
 *      are never something a plugin bundle should inline.
 *   2. `dist/worker.js` — the `worker_thread` entry for the Run path's
 *      terminatable isolate (`@markii/host`'s `run/worker-entry.ts` — see
 *      AGENTS.md's `packages/markii-host` entry). Platform `node`, format
 *      `cjs`, everything (including `wasmoon`) bundled in — a
 *      `worker_thread` is spawned by file path, not `require`d by Obsidian,
 *      so there is no `obsidian` module to keep external here at all.
 *      Sits directly in `dist/`, next to `main.js`, so
 *      `src/run/worker-path.ts`'s `resolveWorkerPath` (given the plugin's
 *      own installed folder) finds it as `worker.js` with no subdirectory
 *      to account for. wasmoon's `glue.wasm` cannot be bundled INTO the JS
 *      (it's a real WASM binary, not source `wasmoon` can inline), so it is
 *      copied to sit next to the compiled worker (`dist/glue.wasm`) after
 *      every build — see `copyWasmGlue` below and `worker-entry.ts`'s
 *      `resolveWasmUri` for how the worker finds it at runtime via
 *      `__dirname`. Mirrors `apps/vscode/esbuild.config.mjs`'s worker build
 *      exactly, differing only in the output path.
 *
 * `@markii/*` resolves to each package's `src/`, exactly like
 * `scripts/workspace-aliases.config.ts` does for Vite/Vitest, and exactly
 * like `apps/vscode/esbuild.config.mjs` does for its own bundles: the
 * published `exports` maps point at `dist/`, which this repo's
 * `npm run build` (a `tsc --noEmit` typecheck per workspace) deliberately
 * does not produce. That map cannot be imported from here — it is
 * TypeScript and this file is plain ESM run by node — so the roots are
 * repeated below; keep this in sync with `scripts/workspace-aliases.config.ts`
 * if a package this plugin uses changes location.
 */
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Package name -> that package's `src` directory (see the note above). */
const markiiSrcRoots = {
  '@markii/core': path.join(repoRoot, 'packages', 'markii-core', 'src'),
  '@markii/bundle': path.join(repoRoot, 'packages', 'markii-bundle', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
  '@markii/react': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-react',
    'src',
  ),
  '@markii/host': path.join(repoRoot, 'packages', 'markii-host', 'src'),
  '@markii/pack': path.join(repoRoot, 'packages', 'markii-pack', 'src'),
};

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  logLevel: 'info',
  minify: production,
  sourcemap: production ? false : 'inline',
  alias: markiiSrcRoots,
};

/** @type {import('esbuild').BuildOptions} */
const mainBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(here, 'dist', 'main.js'),
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  jsx: 'automatic',
  // `esbuild-wasm`, alongside `obsidian`: `@markii/host`'s
  // `src/packs/pack-build.ts` `require()`s esbuild-wasm's browser entry
  // (`lib/browser.js`, the in-process WebAssembly build path — see that
  // file's top doc comment for why the Node child-process entry,
  // `lib/main.js`, is not used, and can't be: Obsidian's renderer ships no
  // `node` binary on its `PATH`) at runtime rather than importing it
  // normally, so a real, unbundled copy must be resolvable the same way in
  // dev, under Vitest, and once bundled into this plugin. `copyEsbuildWasm`
  // below copies `lib/browser.js` and the `esbuild.wasm` binary next to
  // `dist/main.js`; `main.ts`'s `esbuildBrowserModulePath`/
  // `esbuildWasmBinaryPath` point `pack-build.ts`'s `loadEsbuildWasm` at
  // them. Mirrors `apps/vscode/esbuild.config.mjs`'s identical comment.
  external: [
    'obsidian',
    'electron',
    'esbuild-wasm',
    '@codemirror/*',
    '@lezer/*',
    'node:*',
    'fs',
    'path',
    'os',
    'crypto',
  ],
  // `@markii/host`'s `src/packs/pack-build.ts` references `import.meta.url`
  // (guarded by a `typeof require` runtime check) purely for the ESM/
  // dev-and-Vitest half of that check; the CJS bundle this build produces
  // never evaluates it. esbuild's warning here is accurate but inert.
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
  outfile: path.join(here, 'dist', 'worker.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Spawned by file path via `worker_threads`, never `require`d by
  // Obsidian itself — there is no `obsidian` module in this bundle's graph
  // at all (`src/run/**` is host-free by design), so nothing needs to be
  // external here.
  external: [],
};

const workerOutDir = path.join(here, 'dist');

/**
 * Copies wasmoon's `glue.wasm` next to the compiled worker bundle. Plain
 * `node_modules` resolution (this repo hoists it to the root via
 * `@markii/lua`'s own dependency) rather than `import.meta.resolve`/
 * `require.resolve`, mirroring `apps/vscode/esbuild.config.mjs`'s
 * `copyWasmGlue` exactly. Re-run on every build (dev and `--production`
 * alike): cheap, and keeps a stale copy from ever lingering after a
 * `wasmoon` version bump.
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

const esbuildWasmOutDir = path.join(here, 'dist', 'esbuild-wasm');

/**
 * Copies the REAL, unbundled `esbuild-wasm/lib/browser.js` (the in-process
 * WebAssembly entry — see `mainBuild`'s `external` comment above) next to
 * `dist/main.js` (`dist/esbuild-wasm/lib/browser.js`), plus the
 * `esbuild.wasm` binary it compiles at runtime via `WebAssembly.compile` —
 * so `pack-build.ts`'s `loadEsbuildWasm`, given these two paths (from
 * `main.ts`'s `esbuildBrowserModulePath`/`esbuildWasmBinaryPath`), can
 * `require()`/read them directly at runtime without depending on
 * `node_modules/esbuild-wasm` still being present relative to the
 * installed plugin folder. Only these two files: the child-process half of
 * the package (`bin/esbuild`, `wasm_exec*.js`) is not needed at all, and
 * the rest (`.d.ts` files, docs) is dead weight either way. Mirrors
 * `apps/vscode/esbuild.config.mjs`'s `copyEsbuildWasm` exactly.
 */
function copyEsbuildWasm() {
  mkdirSync(path.join(esbuildWasmOutDir, 'lib'), { recursive: true });
  const packageDir = path.join(repoRoot, 'node_modules', 'esbuild-wasm');
  copyFileSync(
    path.join(packageDir, 'lib', 'browser.js'),
    path.join(esbuildWasmOutDir, 'lib', 'browser.js'),
  );
  copyFileSync(
    path.join(packageDir, 'esbuild.wasm'),
    path.join(esbuildWasmOutDir, 'esbuild.wasm'),
  );
}

if (watch) {
  const contexts = await Promise.all([
    context(mainBuild),
    context(workerBuild),
  ]);
  copyWasmGlue();
  copyEsbuildWasm();
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([build(mainBuild), build(workerBuild)]);
  copyWasmGlue();
  copyEsbuildWasm();
}
