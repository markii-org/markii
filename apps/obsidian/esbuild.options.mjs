/**
 * One published bundle, one build script:
 *
 *   `dist/main.js` — Obsidian expects a plugin's entry to be named exactly
 *   `main.js` sitting directly in its plugin folder alongside
 *   `manifest.json` and `styles.css` — but that plugin folder is the
 *   *installed* location inside a vault
 *   (`<vault>/.obsidian/plugins/markii/`), not this workspace directory
 *   itself. Building to `dist/` (rather than dropping `main.js` at the
 *   workspace root) keeps the generated bundle covered by the repo's
 *   existing `dist/` ignore/lint-exclusion patterns, the same way every
 *   other workspace's build output already is; the manual-install steps
 *   (see the task report) copy `manifest.json`, `styles.css`, and every
 *   file under `dist/` into that plugin folder. Format `cjs` (Obsidian
 *   loads a plugin's `main.js` the same way VS Code loads an extension's
 *   `main`, via `require`), platform `browser` (the plugin runs inside
 *   Obsidian's renderer process, not a plain Node host), with `obsidian`
 *   and Electron/Node builtins marked external — Obsidian injects
 *   `obsidian` itself at runtime, and Electron's own built-ins (plus
 *   `node:worker_threads`, which `@markii/host`'s `spawnRun` uses
 *   directly — Obsidian desktop's renderer runs with Node integration,
 *   exactly like the other Node builtins this bundle already externalizes)
 *   are never something a plugin bundle should inline.
 *
 * `worker.browser.js` — the Web Worker entry for the Run path's
 * terminatable isolate (`@markii/host`'s `run/worker-entry-browser.ts` —
 * see AGENTS.md's `packages/markii-host` entry) — is no longer written to
 * `dist/` as its own file. It is built IN-PROCESS (`buildEmbeddedAssets`
 * below) and base64-embedded straight into `main.js`, along with wasmoon's
 * `glue.wasm`. That is a deliberate change from the old two-file-plus-wasm
 * layout: Obsidian's single-file install channels (BRAT today, the
 * community plugin catalogue later) fetch only `main.js`, `manifest.json`,
 * and `styles.css` — a Run path that depended on `worker.browser.js`/
 * `glue.wasm` being copied alongside those three would silently do nothing
 * for anyone who installed that way. Embedding the bytes makes a 3-file
 * install fully functional. See `createMainBuild`'s `embed-runtime-assets`
 * plugin and `src/run/embedded-assets.ts`/`src/run/browser-worker.ts` for
 * the decode-and-blob-URL half on the consuming side.
 *
 * `dist/esbuild-wasm/` is still written as real files (`copyEsbuildWasm`
 * below) — at roughly 14 MB it is deliberately NOT embedded; pack
 * compilation degrades gracefully without it rather than bloating every
 * install by an order of magnitude. So the full `dist/` a build produces
 * today is just `main.js` and `esbuild-wasm/`.
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
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
  '@markii/stdlib': path.join(repoRoot, 'packages', 'markii-stdlib', 'src'),
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

const embeddedAssetsFile = path.join(here, 'src', 'run', 'embedded-assets.ts');

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
 *
 * This object is no longer built to a `dist/` file by the runner
 * (`esbuild.config.mjs`) — it stays exported because the probe
 * (`src/run/browser-worker-bundle.probe.test.ts`) and `buildEmbeddedAssets`
 * below both build it themselves, in-process, from these exact options.
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

const wasmGluePath = path.join(
  repoRoot,
  'node_modules',
  'wasmoon',
  'dist',
  'glue.wasm',
);

/**
 * Builds the worker bundle in-process and reads wasmoon's `glue.wasm`,
 * returning both as base64 ready to embed into `main.js`.
 *
 * `overrides` lets the caller layer production flags (`minify`/
 * `sourcemap`) onto `workerBuild` without mutating the exported object —
 * `createMainBuild`'s plugin uses this to make the embedded worker match
 * the main bundle's own production-ness exactly.
 *
 * Throws if the worker build produced no output file, or if either
 * base64 payload comes back empty — a `main.js` that embeds nothing is
 * indistinguishable from a broken plugin (the Run path just silently
 * fails), so this is the point the build refuses to succeed rather than
 * shipping that.
 */
export async function buildEmbeddedAssets(overrides = {}) {
  const result = await build({
    ...workerBuild,
    ...overrides,
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const outputFile = result.outputFiles?.[0];
  if (!outputFile) {
    throw new Error(
      'markii: buildEmbeddedAssets got no output file from the worker build — cannot embed an empty worker bundle into main.js.',
    );
  }
  const workerBundleBase64 = Buffer.from(outputFile.contents).toString(
    'base64',
  );
  if (workerBundleBase64 === '') {
    throw new Error(
      'markii: buildEmbeddedAssets produced an empty worker bundle base64 payload.',
    );
  }

  const wasmGlueBase64 = readFileSync(wasmGluePath).toString('base64');
  if (wasmGlueBase64 === '') {
    throw new Error(
      'markii: buildEmbeddedAssets read an empty glue.wasm — refusing to embed it into main.js.',
    );
  }

  const watchFiles = [
    ...Object.keys(result.metafile.inputs).map((input) =>
      path.resolve(repoRoot, input),
    ),
    wasmGluePath,
  ];

  return { workerBundleBase64, wasmGlueBase64, watchFiles };
}

/**
 * Builds the `dist/main.js` options object fresh each call, with an
 * esbuild plugin (`embed-runtime-assets`) spliced in that swaps
 * `src/run/embedded-assets.ts`'s placeholder exports for the real,
 * base64-encoded worker bundle and `glue.wasm` at build time.
 *
 * `onStart` re-runs `buildEmbeddedAssets` on every build, including every
 * rebuild triggered by watch mode — so a worker-source edit under watch
 * produces a freshly embedded worker automatically, not a stale one from
 * the first build. `onLoad`'s `watchFiles` (the worker bundle's own
 * transitive inputs, plus `glue.wasm`'s path) is what makes esbuild notice
 * such an edit in the first place and re-trigger that rebuild; without
 * them, watch mode would only rebuild `main.js` when a file `main.js`
 * itself imports changes, never when only the worker's sources do.
 *
 * This ordering makes a stale embed impossible by construction: `main.js`
 * is never built from a worker bundle that predates it, because building
 * the worker bundle is a step INSIDE `main.js`'s own build, not a
 * separate pass that could run before or after it.
 */
export function createMainBuild() {
  /** @type {{ workerBundleBase64: string; wasmGlueBase64: string; watchFiles: string[] } | undefined} */
  let embedded;
  /**
   * Whether `onLoad` actually swapped `src/run/embedded-assets.ts` this
   * build. Checked in `onEnd` below, because the failure it guards is
   * SILENT otherwise: if the filter ever stops matching (the file renamed
   * or moved, an esbuild change to how `filter`/`namespace` are applied),
   * esbuild would happily load the real placeholder module, `main.js`
   * would ship with two empty base64 strings, and every install's Run
   * button would do nothing at all with no build error to show for it.
   * That is exactly the mute failure AGENTS.md's "clean is not silent"
   * rule forbids, so the build refuses instead.
   */
  let substituted = false;

  /** @type {import('esbuild').Plugin} */
  const embedRuntimeAssets = {
    name: 'embed-runtime-assets',
    setup(pluginBuild) {
      pluginBuild.onStart(async () => {
        substituted = false;
        embedded = await buildEmbeddedAssets({
          minify: production,
          sourcemap: production ? false : 'inline',
        });
      });
      pluginBuild.onLoad(
        { filter: /embedded-assets\.ts$/, namespace: 'file' },
        (args) => {
          if (args.path !== embeddedAssetsFile) return undefined;
          if (!embedded) {
            throw new Error(
              'markii: embed-runtime-assets onLoad ran before onStart populated the embedded bytes.',
            );
          }
          const contents = [
            `export const EMBEDDED_WORKER_BUNDLE_BASE64 = ${JSON.stringify(
              embedded.workerBundleBase64,
            )};`,
            `export const EMBEDDED_WASM_GLUE_BASE64 = ${JSON.stringify(
              embedded.wasmGlueBase64,
            )};`,
            '',
          ].join('\n');
          substituted = true;
          return { contents, loader: 'ts', watchFiles: embedded.watchFiles };
        },
      );
      pluginBuild.onEnd((result) => {
        // Only meaningful for a build that otherwise succeeded: a build
        // that already failed for its own reasons may never have reached
        // the module at all, and a second, misleading error helps nobody.
        if (result.errors.length > 0) return;
        if (substituted) return;
        return {
          errors: [
            {
              text:
                'markii: the embed-runtime-assets plugin never substituted src/run/embedded-assets.ts, ' +
                'so main.js would ship with an empty worker bundle and no Lua wasm. Check that the file ' +
                'still exists at that path and that the onLoad filter matches it.',
            },
          ],
        };
      });
    },
  };

  return {
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
    plugins: [embedRuntimeAssets],
  };
}

const esbuildWasmOutDir = path.join(here, 'dist', 'esbuild-wasm');

/**
 * Copies the REAL, unbundled `esbuild-wasm/lib/browser.js` (the in-process
 * WebAssembly entry — see `createMainBuild`'s `external` comment above)
 * next to `dist/main.js` (`dist/esbuild-wasm/lib/browser.js`), plus the
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
