/**
 * The Web Worker isolate entry, for a host that cannot create a worker
 * thread. An Obsidian plugin is the case that forced it: its Electron
 * renderer rejects `node:worker_threads` outright ("The V8 platform used by
 * this instance of Node does not support creating Workers"), and forking a
 * Node child through `ELECTRON_RUN_AS_NODE` was measured failing there too.
 *
 * Everything a run actually DOES lives in `./run-job.ts` and is shared with
 * the Node entry, so the sandbox, the tier gate, the marshaling limits, and
 * the failure classification cannot drift between hosts. This file supplies
 * only the two things a Web Worker has to do differently:
 *
 *   1. Network goes through `./net-bridge.ts` to the host, which runs the
 *      same pinned provider as before. A Web Worker does have network
 *      globals, so `lockdownWorkerGlobals` (below) removes them before any
 *      script runs. Lua cannot reach JavaScript at all; the removal is a
 *      second wall for the case where an interpreter escape does.
 *   2. wasmoon's `glue.wasm` arrives as a URL on the job, because there is
 *      no `__dirname` here to find it beside the bundle.
 *
 * The protocol is the same one-job-in, one-result-out shape `run-host.ts`
 * expects, with net traffic interleaved: any message that is not a net
 * reply is the job.
 */
import {
  isRunJob,
  resultForInternalError,
  runJob,
  type RunJob,
  type RunResult,
} from './run-job.js';
import { createNetBridge } from './net-bridge-worker.js';
import type { NetBridgeRequest } from './net-bridge.js';

/** The Web Worker global surface this entry uses, named so the file typechecks without DOM lib types. */
interface WorkerGlobal {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
}

declare const self: WorkerGlobal;

/**
 * Globals through which a worker can open a connection or keep state outside
 * the run. `fetch` and `importScripts` are handled separately because the
 * Lua engine's start-up needs them (see `lockdownWorkerGlobals`).
 */
const REMOVED_GLOBALS = [
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  // A nested worker would start with a fresh, unlocked global scope.
  'Worker',
  'SharedWorker',
  'WebTransport',
  'WebSocketStream',
] as const;

/** Reads the URL out of a `fetch` argument without assuming DOM types. */
function requestUrl(input: unknown, base: string): string | undefined {
  try {
    if (typeof input === 'string') return new URL(input, base).href;
    if (input instanceof URL) return input.href;
    const url = (input as { url?: unknown } | null)?.url;
    if (typeof url === 'string') return new URL(url, base).href;
  } catch {
    // an unparseable URL is not the allowed one
  }
  return undefined;
}

/**
 * Removes the worker's own ways to reach a network, once, before the first
 * script runs.
 *
 * - Every name in `REMOVED_GLOBALS` (the connection and storage
 *   constructors, and `Worker`, which would start an unlocked scope) is
 *   shadowed with `undefined`.
 * - `importScripts` becomes a function that throws. It stays a function
 *   because the Lua engine's start-up detects a worker by
 *   `typeof importScripts`.
 * - `fetch` keeps working for exactly one URL, the `glue.wasm` the job
 *   named, because the engine loads its WebAssembly through it for every
 *   script. Any other URL is refused.
 *
 * Net traffic is unaffected: it goes to the host with `postMessage`.
 * Idempotent. Covered by `worker-entry-browser.test.ts` and, in a real
 * browser, by the e2e suite.
 */
export function lockdownWorkerGlobals(
  scope: object,
  wasmUri: string | undefined,
): void {
  const target = scope as Record<string, unknown> & {
    location?: { href?: string };
  };
  if ((target as { __markiiLocked?: boolean }).__markiiLocked) return;
  const base = target.location?.href ?? 'http://localhost/';
  const allowed = wasmUri === undefined ? undefined : requestUrl(wasmUri, base);
  const realFetch = target.fetch;

  const shadow = (name: string, value: unknown): void => {
    try {
      Object.defineProperty(scope, name, {
        value,
        configurable: false,
        writable: false,
      });
    } catch {
      // A non-configurable property cannot be shadowed; assign instead.
      try {
        target[name] = value;
      } catch {
        // nothing more can be done for this name
      }
    }
  };

  for (const name of REMOVED_GLOBALS) shadow(name, undefined);
  shadow('importScripts', () => {
    throw new Error('importScripts is not available in the run isolate');
  });
  if (typeof realFetch === 'function') {
    shadow('fetch', (input: unknown, init?: unknown) => {
      const url = requestUrl(input, base);
      if (allowed !== undefined && url === allowed) {
        return (realFetch as (...args: unknown[]) => unknown).call(
          scope,
          input,
          init,
        );
      }
      return Promise.reject(
        new TypeError('network access is not available in the run isolate'),
      );
    });
  }
  Object.defineProperty(scope, '__markiiLocked', { value: true });
}

/**
 * A job for this entry additionally carries where `glue.wasm` can be
 * fetched from — a blob URL the host minted from the file on disk. Absent,
 * wasmoon falls back to its own resolution, which in a Web Worker will not
 * find anything; the host is expected to always send it.
 */
export interface BrowserRunJob extends RunJob {
  wasmUri?: string;
}

function start(scope: WorkerGlobal): void {
  const bridge = createNetBridge((message: NetBridgeRequest) => {
    scope.postMessage(message);
  });

  let running = false;

  scope.addEventListener('message', (event) => {
    const message: unknown = event.data;

    // Net replies arrive throughout the run; the bridge ignores anything
    // that is not one of its own.
    bridge.handleMessage(message);

    if (running) return;
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { kind?: unknown }).kind === 'markii:net-reply'
    ) {
      return;
    }
    running = true;

    void (async () => {
      if (!isRunJob(message)) {
        scope.postMessage(
          resultForInternalError(
            new Error('worker received a malformed job message'),
            {},
          ),
        );
        return;
      }
      const job = message as BrowserRunJob;
      lockdownWorkerGlobals(scope, job.wasmUri);
      let result: RunResult;
      try {
        result = await runJob(job, {
          createNet: () => bridge.provider,
          wasmUri: job.wasmUri,
          // GitHub issue #35: the same per-script message the Node entry
          // sends, on the same channel this worker posts its result on, so
          // ordering (progress before result) holds here too. Built in
          // `./run-job.ts`, never here.
          postProgress: (progress) => {
            scope.postMessage(progress);
          },
        });
      } catch (err) {
        result = resultForInternalError(err, job.cacheSnapshot ?? {});
      }
      scope.postMessage(result);
    })();
  });
}

// Guarded so importing this module in a test (or anywhere that is not a
// worker) is inert rather than throwing on a missing `self`.
if (
  typeof self !== 'undefined' &&
  typeof self.addEventListener === 'function'
) {
  start(self);
}

export { start as startBrowserWorker };
