/**
 * The pinned network provider: the code that actually performs a `net.*`
 * request, follows redirects, re-checks every hop against the allowlist,
 * and connects to an address it vetted itself (GitHub issue #10,
 * docs/security.md).
 *
 * It lives in its own module, with NO `@markii/lua` runtime import, because
 * it now runs in two very different places. In the VS Code extension it
 * runs inside the worker thread, as it always has. In the Obsidian plugin
 * it runs in the RENDERER, on behalf of a Web Worker isolate that has no
 * `node:dns` to pin with and therefore cannot do this for itself (see
 * `./browser-isolate.ts`). That renderer bundle must not contain a
 * WebAssembly Lua engine it never runs, so the one value this file used to
 * import from `@markii/lua` — the brand that marks a policy refusal — is
 * injected as `denial` instead. Types are `import type` and erase.
 *
 * The security properties are unchanged by the move, and one improves: an
 * isolate that has no network stack cannot bypass the allowlist enforced
 * here, because it has nothing to bypass it with.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';

import type { NetProvider, NetResponse } from '@markii/lua';
import {
  pinHostAddress,
  pinnedLookup,
  type HostLookup,
  type PinnedAddress,
  type PinPolicy,
} from './net-pinning.js';

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A same-hop, same-host redirect chain is capped at this many hops (B-1):
 * an allowed host is free to redirect a handful of times (a login/CDN
 * bounce is common), but an unbounded chain is itself a resource-abuse
 * shape worth refusing outright rather than following forever.
 */
const MAX_REDIRECTS = 5;

/**
 * The resolver `createNetProvider` pins against when the host does not
 * inject one (GitHub issue #10): every address a real DNS lookup returns
 * for a hostname, in the shape `pinHostAddress` (`./net-pinning.ts`)
 * expects. `all: true` is what makes this the FULL set of addresses a name
 * resolves to, rather than just the one Node's default resolution would
 * pick — vetting only the address Node happened to choose is exactly the
 * incomplete check a rebinding attacker relies on. `verbatim: true` asks
 * Node not to reorder that set for connection-preference reasons, which
 * have nothing to do with vetting it.
 */
const defaultHostLookup: HostLookup = async (hostname) => {
  const results = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return results.map((entry) => ({
    address: entry.address,
    family: entry.family,
  }));
};

function bareHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/** One hop's raw response — enough for the redirect loop to decide the next step. Never exposed to Lua directly; only the FINAL hop's `{status, body}` becomes a `NetResponse`. */
interface HopResponse {
  status: number;
  location: string | undefined;
  body: string;
}

/**
 * Issues exactly one HTTP(S) request, pinned to `pinned.address` via
 * `pinnedLookup` (`./net-pinning.ts`, GitHub issue #10) — Node's `lookup`
 * request option is what makes this possible without `fetch` (which has no
 * such hook short of an undici dispatcher, and adding a dependency for that
 * is out of scope; see `createNetProvider`'s doc comment). The socket can
 * only ever connect to `pinned.address`, while `url.hostname` still drives
 * the `Host` header and, for `https:`, the TLS certificate check and SNI —
 * `rejectUnauthorized` is never touched here, so a certificate that does
 * not cover the real hostname still fails the handshake (verified
 * empirically against Node 22). `agent: false` so no pooled connection is
 * ever reused across hosts or hops.
 *
 * The response body is read bounded to `maxFetchBytes` (B-2): a
 * `content-length` header over the cap is rejected WITHOUT reading
 * anything, and otherwise the read is aborted — the response socket is
 * destroyed — the moment the running byte total exceeds the cap. The whole
 * body is never buffered before that check runs; `chunks` only ever holds
 * bytes already known to be within the cap.
 */
function issueRequest(
  url: URL,
  method: string,
  body: string | undefined,
  pinned: PinnedAddress,
  maxFetchBytes: number,
  /** See `createNetProvider`'s own `denial` parameter — injected for the same reason. */
  denial: (message: string) => Error,
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const bodyBuffer =
      body !== undefined ? Buffer.from(body, 'utf8') : undefined;
    // The headers `fetch` used to add on its own, restored explicitly now
    // that this path builds the request itself. They are not cosmetic: with
    // no `user-agent`, api.github.com answers 403 ("Please make sure your
    // request has a User-Agent"), which would break every note fetching the
    // GitHub API while every local-server test still passed. The values are
    // exactly what Node's `fetch` sent for a string body, so this port
    // changes nothing that leaves the machine.
    const headers: Record<string, string> = {
      'user-agent': 'node',
      accept: '*/*',
    };
    if (bodyBuffer) {
      headers['content-length'] = String(bodyBuffer.byteLength);
      headers['content-type'] = 'text/plain;charset=UTF-8';
    }

    // Exactly-once settlement: several of the events below (`res`'s
    // 'error' after a deliberate `destroy()`, `req`'s 'error' after the
    // response already resolved) can fire in close succession once
    // something has been torn down early. Every later one is a no-op.
    let settled = false;
    const settleResolve = (value: HopResponse): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: bareHostname(url.hostname),
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
        // Pins the socket to the vetted address (issue #10) without
        // touching the `Host` header or the TLS certificate check — both
        // are still driven by `hostname` above.
        lookup: pinnedLookup(pinned),
      },
      (res) => {
        const declaredLength = res.headers['content-length'];
        if (declaredLength !== undefined) {
          const declared = Number(declaredLength);
          if (Number.isFinite(declared) && declared > maxFetchBytes) {
            res.destroy();
            settleReject(
              denial(
                `response declares ${declared} bytes, exceeding the ${maxFetchBytes}-byte cap`,
              ),
            );
            return;
          }
        }

        let total = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          total += chunk.byteLength;
          if (total > maxFetchBytes) {
            res.destroy();
            settleReject(
              denial(`response exceeds the ${maxFetchBytes}-byte cap`),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          settleResolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (err) => settleReject(err));
      },
    );

    req.on('error', (err) => {
      settleReject(denial(`request failed: ${describeThrown(err)}`));
    });

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * The worker's `NetProvider` (`@markii/lua`): built on `node:http`/
 * `node:https` rather than global `fetch` (GitHub issue #10) — `fetch` has
 * no way to pin where a request's socket connects short of installing an
 * undici dispatcher, and adding a dependency for that is out of scope
 * (AGENTS.md's Stack list). `node:http`/`node:https`'s own `lookup` request
 * option does the same job without one — see `issueRequest`'s doc comment
 * for what it does and does not affect.
 *
 * One allowlist governs `get`/`post`/`patch` alike (docs/security.md: "the
 * per-host allowlist is the real boundary", not a GET/POST distinction).
 * This is DEFENSE IN DEPTH, not the primary gate — the primary gate is
 * `netGrants` passed to `createLuaExecutor` below, which `@markii/lua`'s
 * `buildCapabilities` already enforces before this provider is ever called
 * (a disallowed host never reaches here at all; it comes back as the
 * standard `'capability-denied'` failure kind, recorded through
 * `@markii/lua`'s non-spoofable denial-recording path — see
 * `capabilities.ts`).
 *
 * Per hop of a redirect chain, in this order:
 *   1. the scheme must be `http:` or `https:` — anything else is refused;
 *   2. a URL carrying credentials (`https://user:pass@host/...`) is refused
 *      outright (N-4) — `fetch` used to give this for free by refusing to
 *      construct a credentialed `Request`; this loop checks it explicitly
 *      instead, on every hop, not only the first;
 *   3. the hop's hostname is checked against `allowlist` — unchanged from
 *      before this port. An allowed host redirecting the request elsewhere
 *      is exactly the SSRF shape a host-string allowlist is meant to close,
 *      and `buildCapabilities` only ever sees the ORIGINAL request URL,
 *      never where a 3xx response actually sent the request. A hop landing
 *      on a non-allowed host is refused WITHOUT that hop's request ever
 *      being made (B-1);
 *   4. `pinHostAddress` (`./net-pinning.ts`) resolves that hostname ONCE and
 *      vets every address it got back against `policy` — the new
 *      DNS-rebinding/private-range close from issue #10: a hostname
 *      allowlist alone cannot see where a name actually resolves, or that
 *      the record can change between the check and the connect;
 *   5. the request is issued pinned to the vetted address (`issueRequest`),
 *      so the socket can only ever reach where step 4 vetted — the
 *      resolve-then-connect gap is closed by construction, not by
 *      re-checking after the fact.
 *
 * The response body is read bounded to `maxFetchBytes`, never buffered
 * whole first — see `issueRequest` (B-2).
 */
export function createNetProvider(
  allowlist: readonly string[],
  maxFetchBytes: number,
  policy: PinPolicy,
  /**
   * How a POLICY refusal is built. The worker passes `@markii/lua`'s
   * `netProviderDenial`, whose `Symbol` brand is what makes a refusal
   * classify as `'capability-denied'` instead of a generic script error.
   *
   * It is injected rather than imported so this module's network half does
   * not drag the Lua runtime in behind it. The Obsidian plugin runs this
   * provider in its RENDERER, on behalf of a Web Worker isolate that has no
   * `node:dns` to pin with, and that renderer bundle must not contain a
   * WebAssembly Lua engine it never runs. The brand is not lost there: the
   * host marks every refusal on the wire (`./net-bridge.ts`'s `denied`
   * flag) and the worker rebuilds a properly branded error on arrival.
   */
  denial: (message: string) => Error,
  lookup: HostLookup = defaultHostLookup,
): NetProvider {
  const allowed = new Set(allowlist.map((host) => host.toLowerCase()));

  async function fetchAllowed(
    startUrl: string,
    method: string,
    body: string | undefined,
  ): Promise<NetResponse> {
    let currentUrl = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        throw denial(`"${currentUrl}" is not a valid URL`);
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw denial(`scheme "${parsed.protocol}" is not allowed`);
      }
      // N-4: a URL carrying credentials is refused outright, on every hop.
      if (parsed.username !== '' || parsed.password !== '') {
        throw denial(
          `URL "${currentUrl}" embeds credentials, which is not allowed`,
        );
      }

      const host = parsed.hostname.toLowerCase();
      if (!allowed.has(host)) {
        throw denial(`host "${host}" is not on the run's allowlist`);
      }

      // Issue #10: resolve-then-pin, closing the DNS-rebinding / private-
      // range SSRF gap a hostname allowlist alone cannot see.
      const pinResult = await pinHostAddress(host, policy, lookup);
      if (!pinResult.ok) {
        throw denial(pinResult.reason);
      }

      const response = await issueRequest(
        parsed,
        method,
        body,
        pinResult.pinned,
        maxFetchBytes,
        denial,
      );

      if (response.status >= 300 && response.status < 400) {
        if (!response.location) {
          throw denial('redirect response carried no Location header');
        }
        try {
          currentUrl = new URL(response.location, currentUrl).toString();
        } catch {
          throw denial(
            'redirect response carried an unparseable Location header',
          );
        }
        continue;
      }

      return { status: response.status, body: response.body };
    }
    throw denial(`exceeded ${MAX_REDIRECTS} redirects`);
  }

  return {
    get: (url) => fetchAllowed(url, 'GET', undefined),
    post: (url, requestBody) => fetchAllowed(url, 'POST', requestBody),
    patch: (url, requestBody) => fetchAllowed(url, 'PATCH', requestBody),
  };
}

/**
 * An in-memory `CacheProvider` (`@markii/lua`) seeded from `snapshot` at
 * construction and readable back out afterward via `.snapshot()` — the
 * "snapshot-in/snapshot-out" design from the locked run-arc comment. No
 * disk/IndexedDB access here: persisting the returned snapshot across runs
 * is `run-host.ts`'s caller's job (extension storage, in the real
 * extension).
 */
