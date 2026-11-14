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
 * - `dist/browser-worker.classic.js` is the same worker as one IIFE for a
 *   host that starts a classic worker (a blob URL), with a banner that
 *   shadows `process`, `Buffer` and `require`. `@markii/host/
 *   browser-worker-classic` exports it. Both builds share
 *   `scripts/browser-worker-build.mjs`.
 * - `dist/node-worker.js` is the worker_threads isolate as ONE self-contained
 *   ES module (wasmoon and @markii/lua bundled in), so a Node host needs no
 *   resolution of the worker's imports. `createNodeHostIsolate` defaults to
 *   it; `@markii/host/node-worker` exports it.
 * - `dist/glue.wasm` is wasmoon's WebAssembly file, next to it, referenced
 *   the same way and sent to the worker as `wasmUri` on every job.
 * - `dist/conformance/host/` is the host conformance corpus, so
 *   `hostConformanceDir()` works from an installed package.
 */
import { cpSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  browserWorkerBuildOptions,
  markiiSrcRoots as browserWorkerRoots,
} from './browser-worker-build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const dist = path.join(pkgRoot, 'dist');

mkdirSync(dist, { recursive: true });
writeFileSync(
  path.join(dist, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
);

const markiiSrcRoots = browserWorkerRoots(repoRoot);

await build({
  ...browserWorkerBuildOptions({ repoRoot, format: 'esm' }),
  entryPoints: [path.join(pkgRoot, 'src', 'run', 'worker-entry-browser.ts')],
  outfile: path.join(dist, 'browser-worker.js'),
  minify: true,
  logLevel: 'info',
});

await build({
  ...browserWorkerBuildOptions({ repoRoot, format: 'iife' }),
  entryPoints: [path.join(pkgRoot, 'src', 'browser-worker-classic.ts')],
  outfile: path.join(dist, 'browser-worker.classic.js'),
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(pkgRoot, 'src', 'node-worker.ts')],
  outfile: path.join(dist, 'node-worker.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  logLevel: 'info',
  alias: markiiSrcRoots,
  // The worker entry finds glue.wasm through `__dirname`, and wasmoon's
  // Emscripten code reads `__filename` and `require`. An ES module has none
  // of them, so the banner defines them.
  banner: {
    js: [
      "import { createRequire as __mkCreateRequire } from 'node:module';",
      "import { fileURLToPath as __mkFileURLToPath } from 'node:url';",
      "import { dirname as __mkDirname } from 'node:path';",
      'const require = __mkCreateRequire(import.meta.url);',
      'const __filename = __mkFileURLToPath(import.meta.url);',
      'const __dirname = __mkDirname(__filename);',
    ].join('\n'),
  },
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

// The neutral main and internal entries must not leak the optional peers' types: no
// declaration reachable from dist/index.d.ts may import @markii/react or
// @markii/html (they stay optional peer dependencies).
{
  const { readFileSync, existsSync } = await import('node:fs');
  const seen = new Set();
  const queue = [
    path.join(dist, 'index.d.ts'),
    path.join(dist, 'internal.d.ts'),
  ];
  const offenders = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g,
    )) {
      const specifier = match[1] ?? match[2];
      if (/^@markii\/(react|html)(\/|$)/.test(specifier)) {
        offenders.push(`${path.relative(dist, file)} imports ${specifier}`);
      } else if (specifier.startsWith('.')) {
        queue.push(
          path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.d.ts')),
        );
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      'dist/index.d.ts or dist/internal.d.ts reaches optional peer types:\n' +
        offenders.join('\n'),
    );
  }
}
