/**
 * The WORKER half of the net bridge (see `./net-bridge.ts` for the
 * protocol and the host half).
 *
 * Separate from its other half for one reason: it needs
 * `@markii/lua`'s `netProviderDenial` to rebrand a host-side refusal, and
 * that import pulls the whole WebAssembly Lua engine in behind it. The
 * worker bundle contains that engine anyway; a host bundle must not.
 */
import { netProviderDenial, type NetProvider } from '@markii/lua';
import { isNetBridgeReply, type NetBridgeRequest } from './net-bridge.js';
import type { NetResponse } from '@markii/lua';

/**
 * The worker-side `NetProvider`: every call becomes one request message and
 * resolves when its reply arrives. `post` on the returned object is what
 * the worker uses to send; the caller routes incoming replies through
 * `handleMessage`.
 *
 * There is deliberately NO timeout here. The run's wall-clock budget is
 * already enforced from outside the isolate by `run-host.ts`'s watchdog,
 * which terminates the whole worker; a second, inner timeout would only
 * add a way for the two to disagree about whether a run is still alive.
 */
export function createNetBridge(post: (message: NetBridgeRequest) => void): {
  provider: NetProvider;
  handleMessage: (message: unknown) => void;
} {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (r: NetResponse) => void; reject: (e: unknown) => void }
  >();

  const request = (
    method: 'get' | 'post' | 'patch',
    url: string,
    body?: string,
  ): Promise<NetResponse> =>
    new Promise<NetResponse>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        post({
          kind: 'markii:net-request',
          id,
          method,
          url,
          ...(body !== undefined ? { body } : {}),
        });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });

  return {
    provider: {
      get: (url) => request('get', url),
      post: (url, body) => request('post', url, body),
      patch: (url, body) => request('patch', url, body),
    },
    handleMessage: (message) => {
      if (!isNetBridgeReply(message)) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok && message.response) {
        waiter.resolve(message.response);
        return;
      }
      const text = message.error ?? 'network request failed';
      // Rebrand a host-side policy refusal so `@markii/lua` classifies it
      // exactly as it would have inside a Node worker.
      waiter.reject(message.denied ? netProviderDenial(text) : new Error(text));
    },
  };
}
