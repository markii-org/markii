/**
 * This plugin's own resolution of the Run path's worker entry file —
 * `@markii/host`'s `run/run-host.ts` deliberately does not guess a host's
 * bundle layout (see that file's `defaultWorkerPath` doc comment), so every
 * host resolves its own bundled worker path and passes it explicitly. This
 * mirrors `apps/vscode/src/worker-path.ts` exactly, but for the Obsidian
 * plugin's own on-disk layout.
 *
 * Plain Node (`node:fs`, `node:path`) — no `obsidian` import — so it stays
 * unit-testable with Vitest, per this plugin's file-scope split (see
 * `src/obsidian-import-guard.test.ts`).
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves the packaged plugin's bundled worker entry given the plugin's
 * OWN on-disk folder (a real directory in the vault:
 * `FileSystemAdapter.getBasePath()` joined with `manifest.dir` — computed
 * by `src/main.ts`, the only place that can reach either of those, and
 * passed in here as a plain string so this module stays `obsidian`-free).
 * `esbuild.config.mjs`'s second output bundles `@markii/host`'s
 * `run/worker-entry.ts` to `worker.js` sitting directly in that same
 * folder, alongside `main.js`/`manifest.json`/`styles.css`.
 *
 * Returns `undefined` when no such file exists yet (dev, before
 * `npm run build` has produced it, or a plugin folder path that doesn't
 * resolve) — never throws. The caller is expected to fall back to
 * `@markii/host`'s own `defaultWorkerPath` dev convenience in that case,
 * exactly as `apps/vscode/src/worker-path.ts`'s `resolveWorkerPath` does.
 */
export function resolveWorkerPath(pluginDir: string): string | undefined {
  const bundled = path.join(pluginDir, 'worker.js');
  if (existsSync(bundled)) return bundled;
  return undefined;
}
