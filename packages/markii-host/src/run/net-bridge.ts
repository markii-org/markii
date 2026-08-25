/**
 * The network half of a Web Worker isolate.
 *
 * A Web Worker has no `node:https` and no `node:dns`, so the pinned
 * request that closes the DNS-rebinding gap (issue #10, docs/security.md)
 * cannot run inside one. Rather than drop pinning for hosts that only have
 * Web Workers, the request moves OUT of the isolate: the worker asks its
 * host to perform it, and the host, which still has Node, runs exactly the
 * same `createNetProvider` the worker-thread isolate always used.
 *
 * This is a security improvement, not a compromise. The allowlist and the
 * pinning policy now live somewhere the sandboxed code cannot reach at
 * all: an isolate with no network stack has nothing to bypass them with.
 * What the worker can do is ask, and every ask is answered by the host's
 * own provider, against the host's own allowlist.
 *
 * This file is the protocol and the HOST half. The worker half lives in
 * `./net-bridge-worker.ts` because it needs `@markii/lua`'s denial brand,
 * and a host bundle must not drag a WebAssembly Lua engine in behind a
 * message type — see `./net-provider.ts` for the same reasoning applied to
 * the pinned request itself.
 */
import type { NetProvider, NetResponse } from '@markii/lua';

/** Worker -> host. `id` correlates the reply; `method` selects the provider call. */
export interface NetBridgeRequest {
  kind: 'markii:net-request';
  id: number;
  method: 'get' | 'post' | 'patch';
  url: string;
  body?: string;
}

/**
 * Host -> worker. A failure crosses as a MESSAGE plus a `denied` flag, never
 * as a structured-cloned `Error`: the branded denial `@markii/lua` checks
 * for is a JS `Symbol` on an Error object, and a `Symbol` does not survive
 * structured cloning. The flag is what lets the worker side rebuild a
 * properly branded denial, so a host-side policy refusal still classifies
 * as `'capability-denied'` rather than degrading to a generic script error.
 */
export interface NetBridgeReply {
  kind: 'markii:net-reply';
  id: number;
  ok: boolean;
  response?: NetResponse;
  error?: string;
  denied?: boolean;
}

export function isNetBridgeRequest(value: unknown): value is NetBridgeRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<NetBridgeRequest>;
  return (
    v.kind === 'markii:net-request' &&
    typeof v.id === 'number' &&
    typeof v.url === 'string' &&
    (v.method === 'get' || v.method === 'post' || v.method === 'patch')
  );
}

export function isNetBridgeReply(value: unknown): value is NetBridgeReply {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<NetBridgeReply>;
  return v.kind === 'markii:net-reply' && typeof v.id === 'number';
}

/**
 * The host-side half: answers one request message using `provider`, and
 * hands the reply to `post`. Never throws — a failure becomes a reply
 * carrying the message, because a worker waiting on a reply that never
 * comes would hang until the watchdog kills it.
 */
export async function serveNetRequest(
  request: NetBridgeRequest,
  provider: NetProvider,
  post: (reply: NetBridgeReply) => void,
): Promise<void> {
  try {
    const call =
      request.method === 'get'
        ? provider.get(request.url)
        : request.method === 'post'
          ? provider.post?.(request.url, request.body ?? '')
          : provider.patch?.(request.url, request.body ?? '');
    if (!call) {
      post({
        kind: 'markii:net-reply',
        id: request.id,
        ok: false,
        error: `${request.method} is not available`,
        denied: true,
      });
      return;
    }
    post({
      kind: 'markii:net-reply',
      id: request.id,
      ok: true,
      response: await call,
    });
  } catch (error) {
    post({
      kind: 'markii:net-reply',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      // Everything the host's provider refuses IS a policy denial: the
      // provider's own failures are allowlist, redirect, size, and pinning
      // refusals. Marking them so keeps the worker's classification
      // identical to the in-worker case.
      denied: true,
    });
  }
}
