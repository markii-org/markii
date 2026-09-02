/**
 * The build RUNNER: `node esbuild.config.mjs [--production] [--watch]`.
 * Every option object lives in `./esbuild.options.mjs`, imported
 * side-effect-free so the Vitest probe
 * (`src/run/browser-worker-bundle.probe.test.ts`) can build the REAL
 * worker bundle with the REAL options and execute it — the guard that a
 * worker-fatal reference (e.g. a dependency's browser build touching
 * `document` at module top level) can never ship silently again.
 *
 * There is only one build target: `main.js`. The worker bundle is not
 * written to `dist/` on its own — it is built in-process and
 * base64-embedded into `main.js` by `createMainBuild`'s
 * `embed-runtime-assets` plugin (see `esbuild.options.mjs`'s top comment),
 * so watch mode only needs a context for the main build; a worker-source
 * edit re-embeds automatically because that plugin's own `watchFiles`
 * cover the worker's transitive inputs. The three bundled packs
 * (`embed-bundled-packs`) embed the same way. There is no separate
 * esbuild-wasm runtime to copy here: this plugin is archive-only, with no
 * pack compiler of its own (AGENTS.md's Host positioning) — a full build
 * produces exactly `dist/main.js`, which the release folder ships
 * alongside `manifest.json` and `styles.css`.
 */
import { build, context } from 'esbuild';
import { statSync } from 'node:fs';
import { createMainBuild } from './esbuild.options.mjs';

const watch = new Set(process.argv.slice(2)).has('--watch');

if (watch) {
  const ctx = await context(createMainBuild());
  await ctx.watch();
} else {
  const mainBuild = createMainBuild();
  await build(mainBuild);
  const { size } = statSync(mainBuild.outfile);
  console.log(`markii: dist/main.js is ${(size / 1024).toFixed(1)} KB`);
}
