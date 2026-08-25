/**
 * Three bundles, one build script:
 *
 *   1. `dist/extension.js`   — the extension host entry. Platform `node`,
 *      format `cjs` (VS Code loads `main` with `require`), with `vscode`
 *      marked external because the editor injects that module at runtime.
 *   2. `dist/webview/main.js` + `dist/webview/main.css` — the preview
 *      webview. Platform `browser`, format `iife` (a single classic script
 *      the CSP can carry one nonce for; no module graph is fetched at
 *      runtime, which is what keeps `script-src` nonce-only). React,
 *      react-dom, `@markii/*` and `doc.css` are all bundled in.
 *   3. `dist/run/worker.js`  — the `worker_thread` entry for the v2 Run arc
 *      (`src/run/worker-entry.ts`, GitHub issue #1's locked design
 *      comment). Platform `node`, format `cjs`, everything (including
 *      `wasmoon`) bundled in — a `worker_thread` is spawned by file path,
 *      not `require`d by VS Code, so there is no `vscode` module to keep
 *      external here at all. wasmoon's `glue.wasm` cannot be bundled INTO
 *      the JS (it's a real WASM binary, not source `wasmoon` can inline),
 *      so it is copied to sit next to the compiled worker
 *      (`dist/run/glue.wasm`) after every build — see `copyWasmGlue`
 *      below and `worker-entry.ts`'s `resolveWasmUri` for how the worker
 *      finds it at runtime via `__dirname`.
 *
 * `@markii/*` resolves to each package's `src/`, exactly like
 * `scripts/workspace-aliases.config.ts` does for Vite/Vitest: the published
 * `exports` maps point at `dist/`, which the repo's `npm run build` (a
 * `tsc --noEmit` typecheck per workspace) deliberately does not produce.
 * That map cannot be imported from here — it is TypeScript and this file is
 * plain ESM run by node — so the roots are repeated below; keep the two in
 * sync when a package is added.
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
  '@markii/stdlib': path.join(repoRoot, 'packages', 'markii-stdlib', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
  '@markii/pack': path.join(repoRoot, 'packages', 'markii-pack', 'src'),
  '@markii/react': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-react',
    'src',
  ),
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
const extensionBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'extension.ts')],
  outfile: path.join(here, 'dist', 'extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // `esbuild-wasm`, alongside `vscode`: `src/packs/pack-build.ts` (GitHub
  // issue #3's compile-pack-from-source slice) `require()`s esbuild-wasm's
  // OWN `lib/main.js` at runtime rather than importing it normally,
  // because esbuild-wasm's Node API refuses to run once bundled into
  // another file (it checks its own `__filename`/`__dirname` against the
  // real package layout and throws otherwise — confirmed empirically).
  // `copyEsbuildWasm` below copies the whole package next to
  // `dist/extension.js` so that real, unbundled `require()` has something
  // to find at runtime; `pack-build.ts`'s `loadEsbuildWasm` doc comment
  // has the other half of this contract.
  external: ['vscode', 'esbuild-wasm'],
  // `src/packs/pack-build.ts` references `import.meta.url` (guarded by a
  // `typeof require` runtime check — see its `resolveRequire` doc
  // comment) purely for the ESM/dev-and-Vitest half of that check; the
  // CJS half this build produces never evaluates it. esbuild's warning
  // here is accurate but inert — silenced rather than left as permanent
  // build noise.
  logOverride: { 'empty-import-meta': 'silent' },
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'webview', 'main.tsx')],
  outfile: path.join(here, 'dist', 'webview', 'main.js'),
  platform: 'browser',
  format: 'iife',
  // VS Code 1.90 ships Electron 29 / Chromium 122; `color-mix()` and
  // `:has()` (used by the theme sheet and `doc.css`) are available there.
  target: 'chrome122',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

/** @type {import('esbuild').BuildOptions} */
const workerBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'run', 'worker-entry.ts')],
  outfile: path.join(here, 'dist', 'run', 'worker.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Spawned by file path via `worker_threads`, never `require`d by VS
  // Code itself — there is no `vscode` module in this bundle's graph at
  // all (`src/run/**` is vscode-free by design), so nothing needs to be
  // external here.
  external: [],
};

const workerOutDir = path.join(here, 'dist', 'run');

/**
 * Copies wasmoon's `glue.wasm` next to the compiled worker bundle. Plain
 * `node_modules` resolution (this repo hoists it to the root, confirmed
 * against `node_modules/wasmoon/dist/glue.wasm`) rather than
 * `import.meta.resolve`/`require.resolve`, since this file has no
 * TypeScript/CJS ambiguity to navigate — it's already plain Node ESM.
 * Re-run on every build (dev and `--production` alike): cheap, and keeps
 * a stale copy from ever lingering after a `wasmoon` version bump.
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
 * Copies the REAL, unbundled `esbuild-wasm` package next to
 * `dist/extension.js` (`dist/esbuild-wasm/`), preserving its own internal
 * relative layout exactly — `lib/main.js` at `lib/`, `bin/esbuild` at
 * `bin/`, `wasm_exec_node.js` and `esbuild.wasm` at the package root — so
 * `src/packs/pack-build.ts`'s `loadEsbuildWasm`, given
 * `dist/esbuild-wasm/lib/main.js`, can `require()` it directly at
 * runtime and have it resolve its own sibling files exactly as it would
 * from a real `node_modules/esbuild-wasm` install (`preview-panel.ts`'s
 * `esbuildMainModulePath` points here). Only these five files: the rest
 * of the published package (`.d.ts` files, the browser-only `esm`/`lib`
 * variants, docs) is dead weight for a Node host. `esbuild.wasm` is what
 * dominates this copy's size (see this file's own top doc comment
 * pattern for `glue.wasm` — same idea, a real WASM binary that cannot be
 * bundled into JS source).
 */
function copyEsbuildWasm() {
  mkdirSync(path.join(esbuildWasmOutDir, 'lib'), { recursive: true });
  mkdirSync(path.join(esbuildWasmOutDir, 'bin'), { recursive: true });
  const packageDir = path.join(repoRoot, 'node_modules', 'esbuild-wasm');
  const files = [
    ['lib/main.js', 'lib/main.js'],
    ['bin/esbuild', 'bin/esbuild'],
    // `wasm_exec_node.js` (the Node-side harness `bin/esbuild` runs)
    // `require()`s `./wasm_exec` (Go's own WebAssembly loader) as a
    // sibling — both are needed, confirmed empirically: omitting
    // `wasm_exec.js` fails with `Cannot find module './wasm_exec'` the
    // first time a build actually runs.
    ['wasm_exec_node.js', 'wasm_exec_node.js'],
    ['wasm_exec.js', 'wasm_exec.js'],
    ['esbuild.wasm', 'esbuild.wasm'],
  ];
  for (const [from, to] of files) {
    copyFileSync(
      path.join(packageDir, ...from.split('/')),
      path.join(esbuildWasmOutDir, ...to.split('/')),
    );
  }
}

if (watch) {
  const contexts = await Promise.all([
    context(extensionBuild),
    context(webviewBuild),
    context(workerBuild),
  ]);
  copyWasmGlue();
  copyEsbuildWasm();
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([
    build(extensionBuild),
    build(webviewBuild),
    build(workerBuild),
  ]);
  copyWasmGlue();
  copyEsbuildWasm();
}
