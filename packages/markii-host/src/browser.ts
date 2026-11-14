// @markii/host/browser: the browser PLATFORM entry, the twin of
// `@markii/host/node`.
//
// The main entry (`./index.ts`) is environment-neutral. This entry adds the
// two things a page needs to run scripts:
// - a Web Worker isolate that starts the packaged module worker and hands it
//   the packaged `glue.wasm` URL on every job;
// - a `fetch`-backed network provider that serves `net.*` calls on the
//   worker's behalf, against an explicit allowlist of ORIGINS.
//
// Nothing reachable from here imports `node:*` (executed probe:
// `apps/vscode/src/browser-entry.probe.test.ts`). In the published package
// `browser-worker.js` and `glue.wasm` sit next to `browser.js`, so the
// `new URL(..., import.meta.url)` references below resolve in a consumer's
// bundler without configuration where that bundler treats them as assets.

import type { NetProvider, NetResponse } from '@markii/lua';
import type { HostIsolate } from './host/adapter.js';
import { createBrowserIsolate } from './run/browser-isolate.js';
import { netRefusal } from './run/net-refusal.js';
import type { IsolateSpawner } from './run/isolate.js';

/** Builds the provider for one run from the job's host allowlist, byte cap and pin policy (the policy is meaningless in a browser and ignored). */
export type BrowserNetProviderFactory = (
  netAllowlist: string[],
  maxFetchBytes: number,
  netPolicy: unknown,
  /** Aborted when the isolate is killed or disposed. A provider cancels its in-flight requests on it. */
  signal?: AbortSignal,
) => NetProvider;

export interface FetchNetProviderOptions {
  /**
   * The origins (`https://api.example.com`, `http://127.0.0.1:8080`) a
   * script may reach. Anything else is denied. Missing or empty denies
   * every request. Entries that do not parse as an http(s) URL are ignored.
   */
  allowedOrigins?: readonly string[];
  /** How a policy refusal is built. Defaults to a plain `Error`. The provider marks every refusal it throws, so the isolate bridge sends it as a denial. A transport failure is never marked. */
  denial?: (message: string) => Error;
  /** The `fetch` to use. Defaults to the global one; injectable for tests. */
  fetch?: typeof fetch;
}

function originOf(entry: string): string | undefined {
  try {
    const url = new URL(entry);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
  denial: (message: string) => Error,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw denial(
      `response declares ${declared} bytes, exceeding the ${maxBytes}-byte cap`,
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel();
      throw denial(`response exceeds the ${maxBytes}-byte cap`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The page-side half of the network bridge for a browser: a request goes
 * out with `fetch` only when its origin is in `allowedOrigins`. Everything
 * else is refused with a denial before any request is made.
 *
 * The grant flow and the tier gate run in front of this (they are shared
 * with every host), so a script still needs the user's grant for the host
 * it names. This allowlist is the second, host-owned boundary.
 *
 * What a browser cannot do, stated plainly: there is NO address pinning
 * here. A page cannot choose which IP a hostname connects to, so the
 * DNS-rebinding and private-range protection the Node provider adds
 * (docs/security.md) does not exist in this provider. The browser's own
 * rules apply instead: CORS decides whether a response is readable, and
 * the same-origin policy stops credentials leaving (requests are sent with
 * `credentials: 'omit'`). Redirects are not followed: the browser hides a
 * manual redirect's target, so it cannot be checked against the allowlist,
 * and a redirect is therefore a denial.
 *
 * Returns a factory because the byte cap arrives per job. Every request
 * carries the run's `AbortSignal`, so killing the isolate cancels requests
 * still in flight.
 */
export function createFetchNetProvider(
  options: FetchNetProviderOptions = {},
): BrowserNetProviderFactory {
  const allowed = new Set(
    (options.allowedOrigins ?? [])
      .map(originOf)
      .filter((origin): origin is string => origin !== undefined),
  );
  const build = options.denial ?? ((message: string) => new Error(message));
  // Every policy refusal is marked so the net bridge can tell it from a
  // transport failure (a plain `Error`).
  const denial = (message: string): Error => netRefusal(build(message));

  return (netAllowlist, maxFetchBytes, _policy, signal) => {
    // The run's granted hosts, re-checked here on the page side: the worker
    // checks them too, but the worker is the isolate a hostile script runs
    // in, so the page is the boundary (the same rule the Node provider
    // follows). A request must pass BOTH this and the origin allowlist.
    const granted = new Set(netAllowlist.map((host) => host.toLowerCase()));
    async function request(
      rawUrl: string,
      method: string,
      body: string | undefined,
    ): Promise<NetResponse> {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        throw denial(`"${rawUrl}" is not a valid URL`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw denial(`scheme "${url.protocol}" is not allowed`);
      }
      if (url.username !== '' || url.password !== '') {
        throw denial(
          `URL "${rawUrl}" embeds credentials, which is not allowed`,
        );
      }
      if (!granted.has(url.hostname.toLowerCase())) {
        throw denial(`host "${url.hostname}" is not on the run's allowlist`);
      }
      if (!allowed.has(url.origin)) {
        throw denial(`origin "${url.origin}" is not on the host's allowlist`);
      }
      if (signal?.aborted) throw new Error('the run has ended');
      const doFetch = options.fetch ?? fetch;
      let response: Response;
      try {
        response = await doFetch(url.href, {
          method,
          ...(body !== undefined
            ? { body, headers: { 'content-type': 'text/plain;charset=UTF-8' } }
            : {}),
          redirect: 'manual',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          ...(signal !== undefined ? { signal } : {}),
        });
      } catch (error) {
        // A transport failure (network down, connection refused, CORS,
        // abort): an ordinary runtime failure with the reason, not a policy
        // refusal.
        throw new Error(
          `request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (response.type === 'opaqueredirect') {
        throw denial('redirects are not followed in a browser');
      }
      if (response.status >= 300 && response.status < 400) {
        throw denial('redirects are not followed in a browser');
      }
      return {
        status: response.status,
        body: await readCapped(response, maxFetchBytes, denial),
      };
    }

    return {
      get: (url) => request(url, 'GET', undefined),
      post: (url, requestBody) => request(url, 'POST', requestBody),
      patch: (url, requestBody) => request(url, 'PATCH', requestBody),
    };
  };
}

export interface BrowserHostIsolateOptions {
  /** Where the module worker lives. Defaults to `browser-worker.js` beside this file. A host that embeds the bytes (a blob URL) passes its own. */
  workerUrl?: string | URL;
  /** Where wasmoon's `glue.wasm` lives. Defaults to `glue.wasm` beside this file. Sent on every job, so the Lua engine never falls back to a CDN. */
  wasmUrl?: string | URL;
  /** How the worker script is loaded. Defaults to `module`, which the packaged `browser-worker.js` is. A host that embeds a classic (IIFE) bundle behind a blob URL passes `classic`. */
  workerType?: 'module' | 'classic';
  /** Serves `net.*` for each run. Defaults to a provider with an empty allowlist, which denies every request. */
  netProvider?: BrowserNetProviderFactory;
}

/**
 * A `HostIsolate` of kind `browser`: each run starts a MODULE Web Worker
 * and the job carries the `glue.wasm` URL. A Web Worker takes no heap cap,
 * so a runaway allocation inside it is bounded only by the browser; Lua's
 * own limits and the external watchdog still apply (docs/security.md).
 */
export function createBrowserHostIsolate(
  options: BrowserHostIsolateOptions = {},
): Extract<HostIsolate, { kind: 'browser' }> {
  const netProvider =
    options.netProvider ?? createFetchNetProvider({ allowedOrigins: [] });
  return {
    kind: 'browser',
    spawner: async (): Promise<IsolateSpawner> => {
      const workerUrl =
        options.workerUrl ?? new URL('./browser-worker.js', import.meta.url);
      const wasmUrl =
        options.wasmUrl ?? new URL('./glue.wasm', import.meta.url);
      return createBrowserIsolate({
        createWorker: () =>
          options.workerType === 'classic'
            ? new Worker(workerUrl)
            : new Worker(workerUrl, { type: 'module' }),
        netProvider,
        wasmUri: String(wasmUrl),
      });
    },
    dispose: () => {},
  };
}
