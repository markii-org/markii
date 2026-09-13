/**
 * Two bundles, one build script, modelled on `apps/vscode/esbuild.config.mjs`:
 *
 *   1. `dist/markii.mjs` — the CLI entry (`src/main.ts`). Platform `node`,
 *      format `esm` (batch 10: the Ink engine's dependency chain carries a
 *      top-level `await` that the `cjs` output format cannot represent —
 *      see `SPIKE-10-findings.md`'s item 6), everything bundled in, with a
 *      combined shebang + `createRequire` banner and made executable
 *      (0o755) after every build so the `bin` entry in `package.json` runs
 *      directly. The file is named `.mjs` (not `.js`) because
 *      `package.json` has no `"type": "module"` field — see the note on
 *      `cliBuild.outfile` below for why that field is not added instead.
 *   2. `dist/run/worker.js` — the `worker_thread` entry for the shared Run
 *      path (`@markii/host`'s `src/run/worker-entry.ts`), exactly like the
 *      VS Code extension's own worker bundle. `dist/run/glue.wasm` is
 *      copied next to it (wasmoon's real WASM binary, which cannot be
 *      bundled into JS source). This bundle never imports ink, stays
 *      `format: 'cjs'`, and is spawned by absolute file path via
 *      `worker_threads` rather than resolved as a module, so it does not
 *      care about `package.json`'s (absent) `"type"` field.
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

/**
 * ink's `reconciler.js` does `await import('./devtools.js')` behind a
 * runtime-only `process.env.DEV === 'true'` check, and `devtools.js`
 * statically imports the optional peer `react-devtools-core`, which this
 * repo does not install. Marking the package `external` is not enough on
 * its own: esbuild inlines the local `devtools.js` module (no code
 * splitting in a single-output-file bundle), which turns the runtime-
 * guarded dynamic import into an unconditional static import of the now-
 * external, not-actually-installed package — the bundle would then throw
 * at startup on every run, `DEV` unset or not. `define`-ing
 * `process.env.DEV` does not fix this either: esbuild does not eliminate
 * code across a dynamic `import()` boundary just because the surrounding
 * condition is statically false (confirmed with and without `minify`,
 * `SPIKE-10-findings.md`'s item 6). The fix is to resolve the bare
 * specifier to an in-memory empty module instead.
 */
const stubReactDevtoolsCore = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub-empty',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-empty' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

/**
 * With `platform: 'node'`, `format: 'esm'`, esbuild bundles ink's CJS
 * dependency chain (`react-reconciler` -> ... -> `signal-exit`) by wrapping
 * each CJS module in a `__commonJS` closure whose own `require(...)` calls
 * become esbuild's `__require` helper, defined as `typeof require !==
 * 'undefined' ? require : (throws)`. Plain ESM run by `node` has no global
 * `require`, so this throws the first time such a call executes
 * (`signal-exit`'s `require('assert')` was the concrete, reproduced
 * trigger in the spike). esbuild does not inject a `createRequire` shim for
 * `format: 'esm'` automatically, so this banner does it by hand. It must be
 * combined with the shebang banner below into one string: esbuild's
 * `banner.js` accepts only one.
 */
const requireShimBanner =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

/**
 * `react` and `ink` are declared in BOTH this package's own `package.json`
 * (`apps/cli/node_modules/react`, `.../ink`) and `@markii/ansi`'s
 * (`packages/platforms/markii-ansi/node_modules/react`, `.../ink`) — two
 * physically separate installs of the identical version, since npm has no
 * shared ancestor `node_modules` to hoist them to while the repo's other
 * workspaces still pin React 18 at the root (`SPIKE-10-findings.md`'s item
 * 0). `src/live-view.ts` importing `ink` from its own location and
 * `@markii/ansi`'s source importing `ink`/`react` from ITS location would
 * therefore bundle two separate copies of React into one process — the
 * exact "Invalid hook call" / "more than one copy of React" failure React
 * itself warns about, reproduced when the live viewer was first run.
 * Aliasing both packages to one absolute path (this app's own copies, since
 * they are already a real dependency here) forces every resolution of
 * either bare specifier — including the ones inside `@markii/ansi`'s
 * aliased source and inside `ink`'s own dependency chain — to the same
 * physical files, collapsing the bundle back to a single React instance.
 */
const reactDir = path.join(here, 'node_modules', 'react');
const reactDedupeAlias = {
  react: path.join(reactDir, 'index.js'),
  // `@markii/ansi`'s `.tsx` sources compile through the automatic JSX
  // runtime (`tsconfig`'s `jsx: 'react-jsx'`), which imports this subpath
  // directly rather than going through the bare `react` specifier above —
  // esbuild's directory-style alias expansion does not apply here since
  // `react`'s own `package.json` `exports` map resolves it to a filename
  // that does not match the subpath, so it needs its own explicit entry.
  'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js'),
  'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
  ink: path.join(here, 'node_modules', 'ink', 'build', 'index.js'),
};

/** @type {import('esbuild').BuildOptions} */
const cliBuild = {
  ...shared,
  alias: { ...markiiSrcRoots, ...reactDedupeAlias },
  entryPoints: [path.join(here, 'src', 'main.ts')],
  // Named `.mjs`, not `.js`: `package.json` has no `"type": "module"`
  // field, so a `.js` output here would be loaded as CommonJS by default.
  // Adding `"type": "module"` to the whole package instead would also
  // change how `tsx` interprets this app's own `.ts` sources in dev, a
  // wider blast radius than this build format change needs.
  outfile: path.join(here, 'dist', 'markii.mjs'),
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: [],
  plugins: [stubReactDevtoolsCore],
  banner: { js: `#!/usr/bin/env node\n${requireShimBanner}` },
  define: {
    'process.env.MARKII_CLI_VERSION': JSON.stringify(cliVersion),
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

/** Makes `dist/markii.mjs` executable so the `bin` entry runs directly. */
function makeExecutable() {
  chmodSync(path.join(here, 'dist', 'markii.mjs'), 0o755);
}

await Promise.all([build(cliBuild), build(workerBuild)]);
copyWasmGlue();
makeExecutable();
