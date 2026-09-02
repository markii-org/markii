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
 *      (`@markii/host`'s `src/run/worker-entry.ts`, GitHub issue #1's
 *      locked design comment; the shared host layer moved to that
 *      workspace so a second host can reuse it — see AGENTS.md's
 *      `packages/markii-host` entry). Platform `node`, format `cjs`,
 *      everything (including `wasmoon`) bundled in — a `worker_thread` is spawned by file path,
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
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  '@markii/host': path.join(repoRoot, 'packages', 'markii-host', 'src'),
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
  // `esbuild-wasm`, alongside `vscode`: `@markii/host`'s
  // `src/packs/pack-build.ts` `require()`s esbuild-wasm's browser entry
  // (`lib/browser.js`, the in-process WebAssembly build path — see that
  // file's top doc comment for why the Node child-process entry,
  // `lib/main.js`, is not used) at runtime rather than importing it
  // normally, so a real, unbundled copy is always resolvable the same way
  // in dev, under Vitest, and once bundled into this extension. It would
  // in fact be SAFE to bundle `lib/browser.js` directly (unlike
  // `lib/main.js`, it carries no self-location check) — kept external
  // anyway to avoid inlining ~1MB of vendored, minified code into
  // `dist/extension.js` for no behavioral gain. `copyEsbuildWasm` below
  // copies `lib/browser.js` and the `esbuild.wasm` binary next to
  // `dist/extension.js` so that real, unbundled `require()` has something
  // to find at runtime; `pack-build.ts`'s `loadEsbuildWasm` doc comment has
  // the other half of this contract.
  external: ['vscode', 'esbuild-wasm'],
  // `@markii/host`'s `src/packs/pack-build.ts` references `import.meta.url`
  // (guarded by a `typeof require` runtime check — see its `resolveRequire`
  // doc comment) purely for the ESM/dev-and-Vitest half of that check; the
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
 * Copies the REAL, unbundled `esbuild-wasm/lib/browser.js` (the in-process
 * WebAssembly entry — see `@markii/host`'s `src/packs/pack-build.ts` top
 * doc comment for why this is the entry used, not the Node
 * child-process one, `lib/main.js`) next to `dist/extension.js`
 * (`dist/esbuild-wasm/lib/browser.js`), plus the `esbuild.wasm` binary it
 * compiles at runtime via `WebAssembly.compile` — so `pack-build.ts`'s
 * `loadEsbuildWasm`, given these two paths, can `require()`/read them
 * directly at runtime without depending on `node_modules/esbuild-wasm`
 * still being present relative to the packaged extension
 * (`preview-panel.ts`'s `esbuildBrowserModulePath`/`esbuildWasmBinaryPath`
 * point here). Only these two files: the child-process half of the package
 * (`bin/esbuild`, `wasm_exec*.js`) is no longer needed at all, and the rest
 * of the published package (`.d.ts` files, docs) is dead weight either way.
 * `esbuild.wasm` is what dominates this copy's size (see this file's own
 * top doc comment pattern for `glue.wasm` — same idea, a real WASM binary
 * that cannot be bundled into JS source).
 */
function copyEsbuildWasm() {
  mkdirSync(path.join(esbuildWasmOutDir, 'lib'), { recursive: true });
  const packageDir = path.join(repoRoot, 'node_modules', 'esbuild-wasm');
  const files = [
    ['lib/browser.js', 'lib/browser.js'],
    ['esbuild.wasm', 'esbuild.wasm'],
  ];
  for (const [from, to] of files) {
    copyFileSync(
      path.join(packageDir, ...from.split('/')),
      path.join(esbuildWasmOutDir, ...to.split('/')),
    );
  }
}

/**
 * GitHub issue #15's "Bundled packs": the extension always ships the three
 * packs at the repo root (`packs/read`, `packs/dash`, `packs/prep`),
 * compiled at extension build time into `dist/packs/<name>/` (`pack.json`,
 * `webview.js`, `webview.css` when the pack has CSS, `scripts/` when it
 * has Lua). `extension.ts`'s pack loading treats `dist/packs` as an
 * always-present pack root ordered ahead of `markii.packs`
 * (`./src/packs/bundled-packs.ts`).
 *
 * The actual compiler (`./src/packs/build-bundled-packs.ts`) reuses
 * `@markii/host`'s pack machinery — `discoverPacks`,
 * `buildPackRegistrationScript`, `exportPack` — the same path the
 * `markii.exportPack` command runs, so there is exactly one pack compiler
 * rather than a second one living only in this build script. That module
 * is TypeScript, so it is bundled here to a throwaway CJS file (the same
 * `@markii/*` -> `src/` alias every other bundle in this file uses) and
 * `require()`d once, synchronously, to run it — a plain `import()` of a
 * dynamically produced CJS file is more fragile across Node versions than
 * an ordinary CJS `require`, and this script already has a real `require`
 * available via `createRequire`.
 */
async function buildBundledPacks() {
  const builderOutfile = path.join(here, 'dist', '.bundled-packs-builder.cjs');
  const builderCacheDir = path.join(here, 'dist', '.bundled-packs-cache');

  await build({
    bundle: true,
    alias: markiiSrcRoots,
    entryPoints: [path.join(here, 'src', 'packs', 'build-bundled-packs.ts')],
    outfile: builderOutfile,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    // Same reasoning as `extensionBuild`'s own `external`: `pack-build.ts`
    // (reached transitively via `@markii/host`) `require()`s esbuild-wasm
    // itself at runtime rather than importing it normally, so it must stay
    // resolvable via plain Node module resolution against this repo's own
    // `node_modules` rather than being inlined here.
    external: ['esbuild-wasm'],
    logLevel: 'silent',
    logOverride: { 'empty-import-meta': 'silent' },
  });

  const req = createRequire(import.meta.url);
  const { buildBundledPacks: runBuilder } = req(builderOutfile);
  try {
    await runBuilder({
      repoRoot,
      outDir: path.join(here, 'dist', 'packs'),
      cacheDir: builderCacheDir,
    });
  } finally {
    await rm(builderOutfile, { force: true });
    await rm(builderCacheDir, { recursive: true, force: true });
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
  await buildBundledPacks();
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([
    build(extensionBuild),
    build(webviewBuild),
    build(workerBuild),
  ]);
  copyWasmGlue();
  copyEsbuildWasm();
  await buildBundledPacks();
}
