/**
 * This CLI's own resolution of the Run path's worker entry file, modelled
 * exactly on `apps/vscode/src/worker-path.ts` — `@markii/host`'s
 * `defaultWorkerPath` deliberately does not know a host's bundle layout,
 * since that differs per host.
 *
 * Resolves in the same two environments this CLI runs in:
 * - the PACKAGED CLI: `esbuild.config.mjs`'s worker build bundles
 *   `@markii/host`'s `run/worker-entry.ts` to `dist/run/worker.js`; since
 *   this file (bundled into `dist/markii.js`) has `__dirname === dist/` at
 *   runtime, `dist/run/worker.js` is exactly
 *   `path.join(__dirname, 'run', 'worker.js')`.
 * - dev/Vitest: this file runs unbundled from `src/`, so `__dirname` is
 *   this real source directory and no bundled worker exists yet —
 *   `resolveWorkerPath` returns `undefined`, and the caller falls back to
 *   `@markii/host`'s own `defaultWorkerPath` dev fallback.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/** Resolves the packaged CLI's bundled worker entry, or `undefined` when no such bundle exists yet. Never throws. */
export function resolveWorkerPath(): string | undefined {
  const bundled = path.join(__dirname, 'run', 'worker.js');
  if (existsSync(bundled)) return bundled;
  return undefined;
}
