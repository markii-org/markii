/**
 * Development and test helpers for running the worker entry straight from
 * source. Not exported from the package and not part of the published build
 * (`tsconfig.build.json` excludes it): the package's own tests and probes,
 * and an app's tests, import it by path.
 *
 * A plain `node` import of the `.ts` worker entry cannot resolve this repo's
 * `@markii/*` bare specifiers or its `./foo.js` to `./foo.ts` convention.
 * `--require tsx/cjs` fixes both. The CJS hook is deliberate: the ESM loader
 * hook deadlocks Node's interop translator for a worker thread that requires
 * `.js`-suffixed relative imports resolving to `.ts` files.
 *
 * `TSX_TSCONFIG_PATH` points tsx at the repo's `tsconfig.dev.json`, so the
 * worker resolves `@markii/*` to each package's SOURCE rather than to a
 * `dist/` that may be stale.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { IsolateSpawner } from './run/isolate.js';
import { workerThreadIsolate } from './run/node-isolate.js';
import { spawnRun } from './run/run-host.js';
import type { SpawnRunOptions } from './run/run-host.js';
import type { RunResult } from './run/worker-entry.js';

const TSX_DEV_EXEC_ARGV = ['--require', 'tsx/cjs'];

/** The sibling `worker-entry.ts` source file. Throws when it is absent. */
export function devWorkerPath(): string {
  const source = path.join(__dirname, 'run', 'worker-entry.ts');
  if (!existsSync(source)) {
    throw new Error(`dev worker entry not found at ${source}`);
  }
  return source;
}

/** A worker-thread isolate that runs a `.ts` entry through tsx against source. */
export const devWorkerIsolate: IsolateSpawner = (options) => {
  const tsconfig = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'tsconfig.dev.json',
  );
  const isTs = options.entryPath.endsWith('.ts');
  return workerThreadIsolate({
    ...options,
    ...(isTs ? { execArgv: options.execArgv ?? TSX_DEV_EXEC_ARGV } : {}),
    ...(isTs && existsSync(tsconfig)
      ? { env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig } }
      : {}),
  });
};

/** `spawnRun` with the dev worker entry and the dev isolate filled in. */
export function spawnRunInThread(
  options: Omit<SpawnRunOptions, 'spawnIsolate' | 'workerPath'> &
    Partial<Pick<SpawnRunOptions, 'spawnIsolate' | 'workerPath'>>,
): Promise<RunResult> {
  return spawnRun({
    ...options,
    workerPath: options.workerPath ?? devWorkerPath(),
    spawnIsolate: options.spawnIsolate ?? devWorkerIsolate,
  });
}

/** A `HostIsolate` of kind `node` for tests: dev worker entry, dev isolate. */
export function devNodeHostIsolate(workerPath?: string): {
  readonly kind: 'node';
  workerPath(): string;
  readonly spawnIsolate: IsolateSpawner;
} {
  return {
    kind: 'node',
    workerPath: () => workerPath ?? devWorkerPath(),
    spawnIsolate: devWorkerIsolate,
  };
}
