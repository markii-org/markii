/**
 * The non-tsc half of `build:dist`, run after `tsc -p tsconfig.build.json`.
 *
 * It finishes the dist folder so the published package works from an
 * install:
 * - `dist/package.json` marks the compiled output as ESM. The package root
 *   is not `"type": "module"` (its sources run under tsx and Vitest as they
 *   always have), so the build scopes the module type to `dist/` instead.
 * - `dist/browser-worker.js` is the Web Worker isolate as ONE self-contained
 *   ES module (wasmoon and @markii/lua bundled in). `browser.js` references
 *   it with `new URL('./browser-worker.js', import.meta.url)`.
 * - `dist/glue.wasm` is wasmoon's WebAssembly file, next to it, referenced
 *   the same way and sent to the worker as `wasmUri` on every job.
 * - `dist/conformance/host/` is the host conformance corpus, so
 *   `hostConformanceDir()` works from an installed package.
 */
import { cpSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const dist = path.join(pkgRoot, 'dist');

mkdirSync(dist, { recursive: true });
writeFileSync(
  path.join(dist, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
);

/** `@markii/*` resolves to each package's `src/`, so the worker never bundles a stale `dist/`. */
const markiiSrcRoots = {
  '@markii/bundle': path.join(repoRoot, 'packages', 'markii-bundle', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
};

await build({
  entryPoints: [path.join(pkgRoot, 'src', 'run', 'worker-entry-browser.ts')],
  outfile: path.join(dist, 'browser-worker.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
  alias: {
    ...markiiSrcRoots,
    // micromark's browser build of this package calls `document.createElement`
    // at module top level, which throws inside a Web Worker. The package's
    // portable `index.js` is a plain character-entities map.
    'decode-named-character-reference': path.join(
      repoRoot,
      'node_modules',
      'decode-named-character-reference',
      'index.js',
    ),
  },
  // wasmoon's Emscripten bundle carries a Node branch behind an environment
  // sniff. A browser worker never takes it; `url` and `module` stay external
  // so esbuild leaves that unreachable branch's imports alone.
  external: ['url', 'module'],
});

copyFileSync(
  path.join(repoRoot, 'node_modules', 'wasmoon', 'dist', 'glue.wasm'),
  path.join(dist, 'glue.wasm'),
);

cpSync(
  path.join(repoRoot, 'conformance', 'host'),
  path.join(dist, 'conformance', 'host'),
  { recursive: true },
);
