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
import type { HostHeaders, NormalizedHostHeaders } from './host-headers.js';
import type { IsolateSpawner, RunIsolate } from './isolate.js';
import { createNetProvider, normalizeNodeHostHeaders } from './net-provider.js';
import { serveNetFromHost } from './net-served-isolate.js';

/**
 * A bare `node:worker_threads` worker, with no network of its own. It is the
 * only kind that accepts `resourceLimits`, so it is also the only kind whose
 * V8 heap is bounded — see `./isolate.ts` for why a host might still have to
 * supply the other one. Never handed out unwrapped: `createWorkerThreadIsolate`
 * puts the host-side network in front of it.
 */
const spawnWorkerThread: IsolateSpawner = (options): RunIsolate => {
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

/**
 * The worker-thread isolate every Node host uses. Its `net.*` requests are
 * answered by the HOST thread through the net bridge, by the pinned provider
 * built from the run's own allowlist, byte cap and pin policy. `headers`
 * (already validated) are added there, so they never enter the worker.
 */
export function createWorkerThreadIsolate(
  headers: NormalizedHostHeaders = new Map(),
): IsolateSpawner {
  return (options) =>
    serveNetFromHost(
      spawnWorkerThread(options),
      (allowlist, maxFetchBytes, policy, signal) =>
        createNetProvider(
          allowlist,
          maxFetchBytes,
          policy as Parameters<typeof createNetProvider>[2],
          (message) => new Error(message),
          undefined,
          signal,
          headers,
        ),
    );
}

/** The default isolate: `createWorkerThreadIsolate()` with no host headers. */
export const workerThreadIsolate: IsolateSpawner = createWorkerThreadIsolate();

export interface NodeHostIsolateOptions {
  /**
   * The worker entry on disk, or a function that finds it when a run asks.
   * A function may throw, and that run then reports the worker as missing.
   * Defaults to `node-worker.js` in the package's `dist/`.
   */
  workerPath?: string | (() => string);
  /**
   * Request headers by ORIGIN (`https://api.github.com`), added to GET
   * requests to exactly that origin and to no redirect hop that leaves it.
   * They are applied on the host side of the net bridge and never enter the
   * worker. An invalid origin or header throws here, at construction. Use a
   * read-only token: a note granted the origin can read with it.
   */
  headers?: HostHeaders;
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
  const spawnIsolate =
    options.headers === undefined
      ? workerThreadIsolate
      : createWorkerThreadIsolate(normalizeNodeHostHeaders(options.headers));
  return {
    kind: 'node',
    workerPath: (): string => {
      if (typeof options.workerPath === 'function') return options.workerPath();
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
    spawnIsolate,
  };
}
