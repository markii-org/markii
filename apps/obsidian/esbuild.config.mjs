/**
 * The build RUNNER: `node esbuild.config.mjs [--production] [--watch]`.
 * Every option object (and the two copy steps) lives in
 * `./esbuild.options.mjs`, imported side-effect-free so the Vitest probe
 * (`src/run/browser-worker-bundle.probe.test.ts`) can build the REAL
 * worker bundle with the REAL options and execute it — the guard that a
 * worker-fatal reference (e.g. a dependency's browser build touching
 * `document` at module top level) can never ship silently again.
 */
import { build, context } from 'esbuild';
import {
  copyEsbuildWasm,
  copyWasmGlue,
  mainBuild,
  workerBuild,
} from './esbuild.options.mjs';

const watch = new Set(process.argv.slice(2)).has('--watch');

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
