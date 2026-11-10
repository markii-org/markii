/**
 * The Node half of the Run path's isolate seam: a `node:worker_threads`
 * worker. Split out of `./run-host.ts` so the watchdog, the exactly-once
 * settlement and the never-rejects contract stay in a module with no
 * `node:*` import and run unchanged for every host kind. Reached only
 * through `@markii/host/node`.
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { HostIsolate } from '../host/adapter.js';
import type { IsolateSpawner, RunIsolate } from './isolate.js';

/**
 * The default isolate: a `node:worker_threads` worker, which is what every
 * Node host uses. It is the only kind that accepts `resourceLimits`, so it is also the only
 * kind whose V8 heap is bounded — see `./isolate.ts` for why a host might
 * still have to supply the other one.
 */
export const workerThreadIsolate: IsolateSpawner = (options): RunIsolate => {
  const worker = new Worker(options.entryPath, {
    ...(options.execArgv ? { execArgv: options.execArgv } : {}),
    ...(options.env ? { env: options.env } : {}),
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
      // `on`, not `once`: a run sends one progress message per script
      // ahead of its single result message, and `spawnRun` tells the two
      // apart. Messages arriving after the run settles are harmless
      // (`settled` guards every path) and the worker is terminated on
      // settle anyway.
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

export interface NodeHostIsolateOptions {
  /** The worker entry on disk. Defaults to `node-worker.js` in the package's `dist/`. */
  workerPath?: string;
}

/**
 * A `HostIsolate` of kind `node`: each run starts a `worker_threads` worker
 * from the packaged, self-contained `node-worker.js`. A host that bundles
 * the worker itself passes its own `workerPath`. The default is resolved
 * when a run asks for it, so constructing the isolate never throws.
 */
export function createNodeHostIsolate(
  options: NodeHostIsolateOptions = {},
): Extract<HostIsolate, { kind: 'node' }> {
  return {
    kind: 'node',
    workerPath: (): string => {
      if (options.workerPath !== undefined) return options.workerPath;
      const packaged = fileURLToPath(
        new URL('../node-worker.js', import.meta.url),
      );
      if (!existsSync(packaged)) {
        throw new Error(
          `the packaged worker was not found at ${packaged}: pass workerPath`,
        );
      }
      return packaged;
    },
    spawnIsolate: workerThreadIsolate,
  };
}
