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
 * - Each of these names is replaced on the global and on every prototype
 *   the global inherits from, because a browser defines some of them
 *   (`fetch`) on `WorkerGlobalScope.prototype`.
 * - `fetch` keeps working for exactly one URL, the `glue.wasm` the job
 *   named, because the engine loads its WebAssembly through it for every
 *   script. Any other URL is refused.
 *
 * Net traffic is unaffected: it goes to the host with `postMessage`.
 * Idempotent. Covered by `worker-entry-browser.test.ts` and, in a real
 * browser, by `e2e/browser-host/tests/worker-isolation.spec.ts`: the
 * removed globals, a refused `fetch` to any other URL, and a prototype chain
 * with no second `fetch`, `XMLHttpRequest` or `WebSocket`.
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
  const realImport = target['importScripts'];

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

  /**
   * Also replaces `name` on every prototype the scope inherits from. A
   * browser defines `fetch` on `WorkerGlobalScope.prototype`, so shadowing
   * only the global's own property would leave
   * `Object.getPrototypeOf(self).fetch` as a way around the lockdown.
   */
  const shadowOnChain = (name: string, value: unknown): void => {
    for (
      let proto: object | null = Object.getPrototypeOf(scope) as object | null;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      if (!Object.hasOwn(proto, name)) continue;
      try {
        Object.defineProperty(proto, name, {
          value,
          configurable: false,
          writable: false,
        });
      } catch {
        // A frozen prototype keeps its member, and nothing more can be done.
      }
    }
  };
  const lock = (name: string, value: unknown): void => {
    shadow(name, value);
    shadowOnChain(name, value);
  };

  for (const name of REMOVED_GLOBALS) lock(name, undefined);
  lock('importScripts', () => {
    throw new Error('importScripts is not available in the run isolate');
  });
  if (typeof realFetch === 'function') {
    lock('fetch', (input: unknown, init?: unknown) => {
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

  // Fail closed: a name that could not be replaced, on the global or on a
  // prototype, means the isolate is not locked, so the run must not start.
  const live: string[] = [];
  const isLive = (holder: object, name: string): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(holder, name);
    if (descriptor === undefined) return false;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      return true;
    }
    if (name === 'fetch') return descriptor.value === realFetch;
    if (name === 'importScripts') return descriptor.value === realImport;
    return descriptor.value !== undefined;
  };
  for (
    let holder: object | null = scope;
    holder !== null && holder !== Object.prototype;
    holder = Object.getPrototypeOf(holder) as object | null
  ) {
    for (const name of [...REMOVED_GLOBALS, 'importScripts', 'fetch']) {
      if (isLive(holder, name)) live.push(name);
    }
  }
  if (live.length > 0) {
    throw new Error(
      `the run isolate could not be locked (${[...new Set(live)].join(', ')})`,
    );
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
      let result: RunResult;
      try {
        lockdownWorkerGlobals(scope, job.wasmUri);
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
