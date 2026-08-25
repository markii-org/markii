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

/**
 * `production` (minify, no sourcemap) keyed off the runner's argv so this
 * module stays importable with no side effects — the Vitest probe
 * (`src/run/browser-worker-bundle.probe.test.ts`) imports these exact
 * options to build and EXECUTE the real worker bundle, which is what keeps
 * the bundle's worker-safety (no `document`, no Node globals) an executed
 * check rather than a code-review hope.
 */
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

/** @type {import('esbuild').BuildOptions} */
export const mainBuild = {
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
/**
 * The Run path's isolate, built for a WEB WORKER rather than a worker
 * thread. Obsidian's Electron renderer refuses `node:worker_threads`
 * ("The V8 platform used by this instance of Node does not support
 * creating Workers"), and forking a Node child through
 * `ELECTRON_RUN_AS_NODE` was measured failing here too, so this is the
 * only isolate this host can create. `worker-entry-browser.ts` is the
 * matching entry: it shares `run-job.ts` with the Node worker, and differs
 * only in getting its network through `@markii/host`'s net bridge (the
 * HOST performs the pinned request, since a Web Worker has no `node:dns`)
 * and its `glue.wasm` from a URL.
 *
 * `format: 'iife'` because a Web Worker started from a blob URL is a
 * classic worker, not a module worker. `platform: 'browser'` so nothing
 * Node-shaped is pulled in; if this bundle ever grows a `node:` import the
 * build fails here, which is exactly the guard wanted.
 */
export const workerBuild = {
  ...shared,
  // `decode-named-character-reference` (micromark, via remark-parse) ships a
  // browser build that calls `document.createElement` AT MODULE TOP LEVEL.
  // esbuild's `platform: 'browser'` picks that build, but this bundle runs
  // in a WEB WORKER, where `document` does not exist -- the worker then
  // throws on load and every run fails before the job even arrives. Alias
  // it to the package's portable `index.js` (a plain character-entities
  // map, no DOM), which is exactly what the Node worker bundle already
  // resolves to via `platform: 'node'`.
  alias: {
    ...shared.alias,
    'decode-named-character-reference': path.join(
      repoRoot,
      'node_modules',
      'decode-named-character-reference',
      'index.js',
    ),
  },
  entryPoints: [
    path.join(
      repoRoot,
      'packages',
      'markii-host',
      'src',
      'run',
      'worker-entry-browser.ts',
    ),
  ],
  outfile: path.join(here, 'dist', 'worker.browser.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  // wasmoon's Emscripten bundle carries BOTH environments and picks one at
  // runtime by sniffing the globals. Obsidian creates its Web Workers WITH
  // Node integration (`process`, `require`, and `Buffer` all exist inside
  // them — verified in a real vault: without the mask below, wasmoon takes
  // its Node path and dies on `import('module')`, which a classic blob
  // worker cannot resolve). The banner's `var process/Buffer = undefined`
  // shadows those globals for the whole bundle, so the sniff sees a plain
  // DedicatedWorkerGlobalScope and takes the browser path both hosts
  // actually support; the `require` guard likewise shadows the real
  // integration-provided `require`, so if the Node branch is ever reached
  // anyway it fails with a sentence rather than doing real Node work.
  // `url`/`module` stay external so esbuild leaves that (now unreachable)
  // branch's imports unresolved instead of failing the build.
  external: ['url', 'module'],
  banner: {
    js: "var process = undefined, Buffer = undefined; var require = (m) => { throw new Error('markii: the Lua runtime took its Node code path inside a Web Worker (tried to require ' + m + ')'); };",
  },
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
export function copyWasmGlue() {
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
export function copyEsbuildWasm() {
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
