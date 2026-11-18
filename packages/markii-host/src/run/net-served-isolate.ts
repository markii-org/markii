/**
 * Wraps any `RunIsolate` so that its `net.*` requests are answered by the
 * HOST, with a provider built from the run's own job (allowlist, byte cap,
 * pin policy). This is the one network path of the worker-thread isolate,
 * the same arrangement the Web Worker isolate uses (`./browser-isolate.ts`).
 *
 * The provider, and any header a host gave it, lives in the host's thread.
 * The job posted to the isolate never carries them.
 */
import type { NetProvider } from '@markii/lua';
import { netArgsFrom } from './browser-isolate.js';
import type { RunIsolate } from './isolate.js';
import {
  isNetBridgeRequest,
  serveNetRequest,
  type NetBridgeReply,
} from './net-bridge.js';

/** Builds the provider for one run. `signal` aborts when the isolate is killed. */
export type RunNetProviderFactory = (
  netAllowlist: string[],
  maxFetchBytes: number,
  netPolicy: unknown,
  signal: AbortSignal,
) => NetProvider;

export function serveNetFromHost(
  isolate: RunIsolate,
  netProvider: RunNetProviderFactory,
): RunIsolate {
  let provider: NetProvider | undefined;
  let alive = true;
  // Aborted by `kill()`: a request in flight when the run ends is cancelled.
  const requests = new AbortController();
  return {
    send: (job) => {
      const { allowlist, maxFetchBytes, policy } = netArgsFrom(job);
      provider = netProvider(allowlist, maxFetchBytes, policy, requests.signal);
      isolate.send(job);
    },
    kill: () => {
      alive = false;
      requests.abort();
      isolate.kill();
    },
    onMessage: (listener) => {
      isolate.onMessage((message) => {
        if (isNetBridgeRequest(message)) {
          if (!provider) return;
          void serveNetRequest(message, provider, (reply: NetBridgeReply) => {
            // A reply to a worker that is already gone must not throw.
            if (!alive) return;
            try {
              isolate.send(reply);
            } catch {
              // The run is over either way.
            }
          });
          return;
        }
        listener(message);
      });
    },
    onError: (listener) => {
      isolate.onError(listener);
    },
    onExit: (listener) => {
      isolate.onExit(listener);
    },
  };
}
