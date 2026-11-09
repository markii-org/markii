/**
 * The Node half of the Run path's isolate seam: a `node:worker_threads`
 * worker, plus the dev/Vitest worker-entry fallback. Split out of
 * `./run-host.ts` so the watchdog, the exactly-once settlement and the
 * never-rejects contract stay in a module with no `node:*` import and run
 * unchanged for every host kind. Reached only through `@markii/host/node`.
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { IsolateSpawner, RunIsolate } from './isolate.js';
import { spawnRun } from './run-host.js';
import type { SpawnRunOptions } from './run-host.js';
import type { RunResult } from './worker-entry.js';

/** `execArgv` needed to run a `.ts` worker entry directly (dev/Vitest only) — see `./worker-entry.ts`'s doc comment on why a plain `node` `.ts` import can't resolve this repo's `@markii/*` bare specifiers or its `./foo.js` -> `./foo.ts` import convention on its own. `--require tsx/cjs` (rather than `tsx/esm`) is deliberate: empirically, the ESM loader hook deadlocks Node's CJS/ESM interop translator for a worker thread requiring `.js`-suffixed relative imports that resolve to `.ts` files (this repo's convention throughout `@markii/*`), while the CJS `require` hook has no such issue. */
const TSX_DEV_EXEC_ARGV = ['--require', 'tsx/cjs'];

/**
 * The ONLY fallback this shared package supplies for an unset `workerPath`:
 * the sibling `worker-entry.ts`, run straight from source via `tsx`
 * (`TSX_DEV_EXEC_ARGV`, above). That is correct for this package's own
 * dev/Vitest runs — `__dirname` at that point is this real source
 * directory — but it says nothing about where a packaged host's bundled
 * worker lives, because this package does not know that host's `dist/`
 * layout. A packaged host (e.g. `apps/vscode`) MUST resolve its own bundled
 * worker path itself and pass it as `SpawnRunOptions.workerPath`; see
 * `apps/vscode/src/worker-path.ts` for that host's resolution and
 * `apps/vscode/esbuild.config.mjs`'s worker build for where it bundles to.
 */
export function defaultWorkerPath(): string {
  // The built package is ESM, where `__dirname` does not exist: a packaged
  // host always passes its own bundled worker, so say so instead of
  // throwing a ReferenceError.
  const devSource =
    typeof __dirname === 'undefined'
      ? undefined
      : path.join(__dirname, 'worker-entry.ts');
  if (devSource !== undefined && existsSync(devSource)) return devSource;

  throw new Error(
    'spawnRun: could not resolve the worker entry file (looked for ' +
      `${devSource ?? 'worker-entry.ts beside the package source'}) — pass workerPath explicitly`,
  );
}

function execArgvFor(workerPath: string): string[] | undefined {
  return workerPath.endsWith('.ts') ? TSX_DEV_EXEC_ARGV : undefined;
}

/**
 * Dev/Vitest only: point `tsx` at the repo's `tsconfig.dev.json` so a
 * `.ts` worker entry resolves `@markii/*` to each package's SOURCE.
 *
 * Without this the worker is a plain Node resolution: a bare `@markii/lua`
 * goes through `node_modules` to that package's `exports`, which name the
 * built `dist/`. `npm run build` only type-checks (`tsc --noEmit`); the
 * emitting script is `build:dist`, which runs at release. So `dist/` is
 * whatever a past release left behind, and a real-isolate probe would
 * silently exercise that stale code instead of the source it is written to
 * test. A capability added since the last `build:dist` simply would not
 * exist inside the worker.
 *
 * Gated on a `.ts` entry, the same signal `execArgvFor` already uses for
 * the tsx hook, so a packaged host passing its own bundled `.js` worker is
 * never touched by this.
 */
function devTsconfigEnv(
  entryPath: string,
): { env: NodeJS.ProcessEnv } | undefined {
  if (!entryPath.endsWith('.ts') || typeof __dirname === 'undefined') {
    return undefined;
  }
  const tsconfig = path.resolve(__dirname, '../../../..', 'tsconfig.dev.json');
  if (!existsSync(tsconfig)) return undefined;
  return { env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig } };
}

/**
 * The default isolate: a `node:worker_threads` worker, which is what every
 * Node host (the VS Code extension host, this package's own tests) uses. It
 * is the only kind that accepts `resourceLimits`, so it is also the only
 * kind whose V8 heap is bounded — see `./isolate.ts` for why a host might
 * still have to supply the other one.
 */
export const workerThreadIsolate: IsolateSpawner = (options): RunIsolate => {
  const execArgv = options.execArgv ?? execArgvFor(options.entryPath);
  const worker = new Worker(options.entryPath, {
    ...(execArgv ? { execArgv } : {}),
    ...(devTsconfigEnv(options.entryPath) ?? {}),
    resourceLimits: {
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb,
    },
  });
  return {
    send: (job) => {
      worker.postMessage(job);
    },
    kill: () => {
      void worker.terminate();
    },
    onMessage: (listener) => {
      // `on`, not `once`: a run now sends one progress message per script
      // (GitHub issue #35) ahead of its single result message, and
      // `spawnRun` is what tells the two apart. Messages arriving after
      // the run settles are harmless — `settled` guards every path — and
      // the worker is terminated on settle anyway.
      worker.on('message', listener);
    },
    onError: (listener) => {
      worker.once('error', listener);
    },
    onExit: (listener) => {
      worker.once('exit', listener);
    },
  };
};

/**
 * `spawnRun` with the Node defaults filled in: the worker-thread isolate and
 * the dev/Vitest worker entry. For this package's own tests and any Node
 * caller that wants them; a packaged host passes its own `workerPath`.
 */
export function spawnRunInThread(
  options: Omit<SpawnRunOptions, 'spawnIsolate' | 'workerPath'> &
    Partial<Pick<SpawnRunOptions, 'spawnIsolate' | 'workerPath'>>,
): Promise<RunResult> {
  return spawnRun({
    ...options,
    workerPath: options.workerPath ?? defaultWorkerPath(),
    spawnIsolate: options.spawnIsolate ?? workerThreadIsolate,
  });
}
