/**
 * This extension's own resolution of the Run path's worker entry file —
 * the layout-specific half `@markii/host`'s `defaultWorkerPath` (`run-host.ts`)
 * deliberately does NOT know, because that package is shared with other
 * hosts (e.g. a future Obsidian plugin) that bundle differently. Plain
 * Node — no `vscode` import — so it stays unit-testable with Vitest.
 *
 * Resolves in the same two environments this extension itself runs in:
 * - the PACKAGED extension: `esbuild.config.mjs`'s worker build bundles
 *   `@markii/host`'s `run/worker-entry.ts` to `dist/run/worker.js`; since
 *   this file (bundled into `dist/extension.js`) has `__dirname === dist/`
 *   at runtime (esbuild flattens a whole bundle into one file, so every
 *   module inside it shares the bundle's own `__dirname` — verified
 *   empirically, see the v2 Run arc's original implementation notes),
 *   `dist/run/worker.js` is exactly `path.join(__dirname, 'run', 'worker.js')`.
 * - dev/Vitest: this file runs unbundled from `src/`, so `__dirname` is
 *   this real source directory and no bundled worker exists yet —
 *   `resolveWorkerPath` returns `undefined`, and the caller is expected to
 *   fall back to `@markii/host`'s own `defaultWorkerPath` (the sibling
 *   `worker-entry.ts` run via `tsx`), exactly as it did before this file
 *   existed.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves the packaged extension's bundled worker entry, or `undefined`
 * when no such bundle exists yet (dev/Vitest, before `npm run build`/
 * `esbuild.config.mjs` has produced `dist/`). Never throws.
 */
export function resolveWorkerPath(): string | undefined {
  const bundled = path.join(__dirname, 'run', 'worker.js');
  if (existsSync(bundled)) return bundled;
  return undefined;
}
