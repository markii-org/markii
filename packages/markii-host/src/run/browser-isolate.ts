/**
 * A `RunIsolate` backed by a Web Worker, for hosts whose runtime cannot
 * create a worker thread (see `./isolate.ts`).
 *
 * Two details are load-bearing.
 *
 * The worker is started from a BLOB URL built from the bundle's own bytes,
 * read off disk by the host. Loading a worker from a `file://` URL is
 * refused by Chromium, and an Electron app's custom protocols are not
 * something this package can assume, so reading the file the host already
 * has and handing it over as a blob sidesteps the question entirely.
 * `glue.wasm` travels the same way, because wasmoon fetches it by URL and
 * there is no `__dirname` inside a worker to find it beside the bundle.
 *
 * Network is served by the HOST, not the worker: `serveNetRequests` wires
 * every `markii:net-request` to the caller's own `NetProvider`, which is
 * the same pinned one a worker-thread isolate runs. The isolate has no
 * network stack of its own, so the allowlist cannot be bypassed from
 * inside it.
 *
 * What this CANNOT do, stated plainly because it is a real difference: a
 * Web Worker takes no `maxOldGenerationSizeMb`, so `options`'s heap cap is
 * accepted and ignored. Lua's own memory limit and the external watchdog
 * still apply; a runaway JavaScript-side allocation inside the isolate is
 * bounded only by the browser engine, and exhausting it can take the host
 * renderer down. docs/security.md records this.
 */
import type { NetProvider } from '@markii/lua';
import type { RunIsolate, SpawnIsolateOptions } from './isolate.js';
import {
  isNetBridgeRequest,
  serveNetRequest,
  type NetBridgeReply,
} from './net-bridge.js';

/** The Web Worker surface this uses, declared structurally so the package needs no DOM lib. */
export interface WorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: (event: unknown) => void,
  ) => void;
}

export interface BrowserIsolateOptions {
  /** Creates the worker. Injected so a test never needs a real one, and so a host can decide how it mints the URL. */
  createWorker: (entryPath: string) => WorkerLike;
  /** The host's own pinned provider. Every `net.*` call the script makes is answered by this, in the host, never in the isolate. */
  netProvider: (
    netAllowlist: string[],
    maxFetchBytes: number,
    netPolicy: unknown,
  ) => NetProvider;
  /** Where the worker should fetch wasmoon's `glue.wasm`; sent along with the job. */
  wasmUri?: string;
}

/** Pulls the fields the host needs to build the same provider the worker would have built for itself. */
function netArgsFrom(job: unknown): {
  allowlist: string[];
  maxFetchBytes: number;
  policy: unknown;
} {
  const j = (job ?? {}) as {
    netAllowlist?: unknown;
    limits?: { maxFetchBytes?: unknown };
    netPolicy?: unknown;
  };
  return {
    allowlist: Array.isArray(j.netAllowlist)
      ? j.netAllowlist.filter((h): h is string => typeof h === 'string')
      : [],
    maxFetchBytes:
      typeof j.limits?.maxFetchBytes === 'number'
        ? j.limits.maxFetchBytes
        : 2 * 1024 * 1024,
    // Fail closed, exactly as the worker does with an absent policy.
    policy: j.netPolicy ?? { allowRestrictedAddresses: false },
  };
}

/** Builds the spawner a host passes as `SpawnRunOptions.spawnIsolate`. */
export function createBrowserIsolate(
  options: BrowserIsolateOptions,
): (spawn: SpawnIsolateOptions) => RunIsolate {
  return (spawn) => {
    const worker = options.createWorker(spawn.entryPath);
    let provider: NetProvider | undefined;
    let alive = true;

    const messageListeners: ((message: unknown) => void)[] = [];
    const errorListeners: ((error: unknown) => void)[] = [];

    worker.addEventListener('message', (event) => {
      const data: unknown = (event as { data?: unknown })?.data;

      if (isNetBridgeRequest(data)) {
        if (!provider) return;
        void serveNetRequest(data, provider, (reply: NetBridgeReply) => {
          // A reply posted to a worker that is already gone would throw and
          // take out this handler; the run is over either way.
          if (alive) worker.postMessage(reply);
        });
        return;
      }
      for (const listener of messageListeners) listener(data);
    });

    worker.addEventListener('error', (event) => {
      const message =
        (event as { message?: unknown })?.message ?? 'worker error';
      for (const listener of errorListeners) {
        listener(new Error(String(message)));
      }
    });

    // A message that could not be deserialized is a failed run, not silence.
    worker.addEventListener('messageerror', () => {
      for (const listener of errorListeners) {
        listener(new Error('worker sent an undeserializable message'));
      }
    });

    return {
      send: (job) => {
        const { allowlist, maxFetchBytes, policy } = netArgsFrom(job);
        provider = options.netProvider(allowlist, maxFetchBytes, policy);
        worker.postMessage({
          ...(job as Record<string, unknown>),
          ...(options.wasmUri !== undefined
            ? { wasmUri: options.wasmUri }
            : {}),
        });
      },
      kill: () => {
        if (!alive) return;
        alive = false;
        worker.terminate();
      },
      onMessage: (listener) => {
        messageListeners.push(listener);
      },
      onError: (listener) => {
        errorListeners.push(listener);
      },
      // A Web Worker has no exit event: `terminate()` is immediate and
      // silent. `spawnRun`'s watchdog path settles on its own timer rather
      // than waiting for one, so there is nothing to report here.
      onExit: () => {},
    };
  };
}
