/**
 * The `worker_thread` entry point for slice 1 of the extension's v2 Run
 * arc (docs: GitHub issue #1's locked design comment). This file is
 * vscode-free — it never imports `vscode` and knows nothing about VS
 * Code's API — so it can be unit-tested directly with Vitest (spawned as a
 * REAL `node:worker_threads` worker, exercising the real wasmoon sandbox)
 * and, unmodified, be the bundled worker `esbuild.config.mjs` produces for
 * the packaged extension.
 *
 * ## Why a whole worker per run
 *
 * The design (docs/security.md's isolate requirement) is "one ephemeral
 * worker per run": the host spawns a fresh thread, this file boots
 * `@markii/lua` + `@markii/runtime` once, runs exactly one batch, posts
 * back exactly one result message, and the whole thread is expected to be
 * torn down by the host afterward (`run-host.ts`) regardless of how this
 * run went. That is what makes the external wall-clock watchdog
 * (`worker.terminate()`) an unconditional, always-available kill switch:
 * it can never be blocked by anything this file's own code does, because
 * `terminate()` acts on the OS/V8 thread itself, not on anything
 * cooperative running inside it.
 *
 * ## Never an unhandled rejection
 *
 * Every path through `main()` below is wrapped so that ANY failure —
 * a malformed job message, `parse()` throwing on pathological input,
 * `runDocumentScripts` itself misbehaving — becomes an ordinary result
 * message carrying a synthetic failure, never a thrown/rejected error that
 * could surface as an "Unhandled Promise Rejection" on the worker thread
 * (which Node would otherwise report noisily, or in the worst case treat
 * as fatal depending on the host's process-wide `--unhandled-rejections`
 * setting). `run-host.ts` therefore never needs an `unhandledRejection`
 * listener on the worker to stay safe.
 */
import { parentPort } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';

import { extractScripts, parse } from '@markii/core';
import {
  createValueStore,
  runDocumentScripts,
  type FailureKind,
  type RunSummaryEntry,
  type RunTrigger,
} from '@markii/runtime';
import {
  createLuaExecutor,
  DEFAULT_MAX_FETCH_BYTES,
  netProviderDenial,
  type CacheEntry,
  type CacheProvider,
  type NetProvider,
  type NetResponse,
} from '@markii/lua';
import type { BundleFsGrant, BundleManifest } from '@markii/bundle';
import { createScriptView } from '@markii/bundle';
import { cacheFilesFrom } from './bundle-run.js';
import { createSnapshotStorage } from './snapshot-storage.js';
import { createPackModuleResolver } from './lua-resolver.js';
import type { PackModulesMap } from './lua-resolver.js';
import {
  pinHostAddress,
  pinnedLookup,
  type HostLookup,
  type PinnedAddress,
  type PinPolicy,
} from './net-pinning.js';

/** The one job message this worker ever receives, posted once by `run-host.ts`. */
export interface RunJob {
  text: string;
  /**
   * How this run was triggered (GitHub issue #11). Passed straight to
   * `runDocumentScripts`, whose `tierForTrigger` (`@markii/runtime`) is THE
   * SECURITY GATE: `'manual'` runs at the full capability tier, while
   * `'auto'` and `'scheduled'` are forced to the read-only tier (GET,
   * cache/bundle reads, cache writes — never POST/PATCH/bundle-write)
   * regardless of what the net/bundle grants allow. Absent (an older host,
   * or `run-host.ts` omitting it) defaults to `'manual'`, preserving the
   * pre-#11 behavior; this default is safe because only the trusted host
   * ever sets this field — note content can never influence it.
   */
  trigger?: RunTrigger;
  /** Hostnames (exact match, case-insensitive) this run's `net.*` calls may reach. */
  netAllowlist: string[];
  /** The persisted `cache.get` state to seed this run with (see `./script-requirements.ts`'s sibling host-side persistence). */
  cacheSnapshot: Record<string, CacheEntry>;
  /**
   * Optional resource-limit overrides, forwarded verbatim to
   * `createLuaExecutor`'s `limits`/`maxFetchBytes`. Left `undefined`, the
   * sandbox's own defaults (`@markii/lua`'s `DEFAULT_LIMITS`/
   * `DEFAULT_MAX_FETCH_BYTES`) apply.
   */
  limits?: {
    maxFetchBytes?: number;
    wallClockMs?: number;
    maxInstructions?: number;
    maxMemoryBytes?: number;
  };
  /**
   * Slice 2 of the `.mkz` Run-path arc (GitHub issue #9): the bundle
   * filesystem capability for a bundle-backed run, entirely as an
   * in-memory snapshot — see `./bundle-run.ts`'s doc comment for what this
   * host-built snapshot contains and why. Absent for a bare `.mk.md` run,
   * exactly as before this field existed.
   */
  bundle?: {
    /** Bundle-relative path -> bytes, built host-side by `./bundle-run.ts`'s `buildBundleSnapshot`. */
    snapshot: Record<string, Uint8Array>;
    /** The bundle's manifest — `@markii/bundle`'s `createScriptView` reads its `permissions.bundle` declaration to intersect against `grantedBundlePermissions`. */
    manifest: BundleManifest;
    /** The user-granted bundle-fs permissions for this run (already the OUTCOME of the host's own grant flow, not the manifest's raw declaration) — `createScriptView` intersects this with what the manifest declares. */
    grantedBundlePermissions: BundleFsGrant[];
  };
  /**
   * Slice 5 of the pack-loading arc (GitHub issue #3): shared Lua modules
   * from every configured, installed pack's `scripts/` directory, pre-read
   * on the extension host (`../packs/pack-scripts.ts`) since this worker has
   * no filesystem access of its own. Builds this run's `PackModuleResolver`
   * (`../packs/lua-resolver.ts`) — a pure, synchronous, in-memory lookup, no
   * I/O inside the worker. Absent for a run with no packs configured, in
   * which case `require "packName/..."` denies exactly as it always has
   * (`@markii/lua`'s own "no resolver configured" capability denial).
   */
  packModules?: PackModulesMap;
  /**
   * The DNS-rebinding / private-range policy (GitHub issue #10) this run's
   * `net.*` calls are pinned under — see `./net-pinning.ts`'s `PinPolicy`.
   * Threaded the same way `trigger` and `packModules` are: forwarded
   * verbatim from `SpawnRunOptions` (`./run-host.ts`) through to here, with
   * no note content able to influence it. FAIL CLOSED: absent (an older
   * host, or a caller that hasn't been updated) means
   * `allowRestrictedAddresses: false` — the safe default — not "no policy
   * at all".
   */
  netPolicy?: PinPolicy;
}

/** One failed script, in the shape the host needs to drive the grant/UI flow — never a raw thrown error. */
export interface RunFailure {
  /** The script's declared `name`, or `'<document>'` for a failure that happened outside any single script (e.g. the text failed to parse). */
  name: string;
  message: string;
  kind: FailureKind;
}

/** The one result message this worker ever posts back. Every field is structured-clone-safe. */
export interface RunResult {
  /** `ValueStore.snapshot()` — every script's outcome, keyed by name. */
  values: Record<string, import('@markii/runtime').StoredValue>;
  failures: RunFailure[];
  /** The mutated cache state, to be persisted by the host for the next run. */
  cacheSnapshot: Record<string, CacheEntry>;
  /**
   * Present only when `RunJob.bundle` was set: the FULL, post-run contents
   * of the bundle snapshot's `cache/` subtree (not a diff) — the host
   * persists this verbatim (directory form: written back into the bundle
   * dir; zip form: extension storage keyed by bundle identity) and seeds
   * the next run's snapshot from it. Absent for a bare `.mk.md` run.
   */
  cacheOut?: Record<string, Uint8Array>;
}

/**
 * A policy denial this module's `NetProvider` raises (an ungranted host, a
 * redirect off the allowlist, too many redirects, an over-size response, a
 * credential-bearing redirect target, a pinning refusal from
 * `./net-pinning.ts`). This is NOT the same kind of denial as
 * `@markii/lua`'s own `netGrants` check inside `buildCapabilities` (which
 * records on its own out-of-band `CapabilityDenials` handle): a denial
 * detected HERE happens inside this provider's own `get`/`post`/`patch`, one
 * level below that check. `netProviderDenial` (`@markii/lua`) brands the
 * thrown `Error` with a JS `Symbol`; `@markii/lua` checks that brand on the
 * JS side of the provider call, BEFORE the error crosses into Lua, records
 * the denial on the same non-spoofable handle its own grant check uses, and
 * re-throws a sanitized capability error. So a provider policy refusal comes
 * back as `'capability-denied'` with no help from `runJob`, and no
 * classification signal ever rides in a Lua-visible string.
 *
 * P2-c fix (docs/archive/PENTEST-REPORT-2026-08-23.md §9.3): the previous approach put a
 * per-run random tag INSIDE the thrown message so `runJob` could reclassify
 * the failure by scanning that message. But the message crosses back into
 * Lua, where a script's own `pcall`/`tostring` reads the tag and then forges
 * it into `error(tag .. ": ...")` to relabel an unrelated failure as
 * capability-denied. The brand lives on the JS `Error` object and is consumed
 * before the Lua boundary, so there is nothing for a script to observe or
 * forge, and `runJob` no longer post-processes failure kinds at all.
 */

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

/**
 * `hostname` with IPv6 brackets stripped, for the `hostname` option
 * `http.request`/`https.request` take: Node re-adds the brackets itself
 * (for the `Host` header and TLS SNI) whenever the raw address contains a
 * `:`, so passing an already-bracketed literal through would double them.
 */
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
              netProviderDenial(
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
              netProviderDenial(
                `response exceeds the ${maxFetchBytes}-byte cap`,
              ),
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
      settleReject(netProviderDenial(`request failed: ${describeThrown(err)}`));
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
        throw netProviderDenial(`"${currentUrl}" is not a valid URL`);
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw netProviderDenial(`scheme "${parsed.protocol}" is not allowed`);
      }
      // N-4: a URL carrying credentials is refused outright, on every hop.
      if (parsed.username !== '' || parsed.password !== '') {
        throw netProviderDenial(
          `URL "${currentUrl}" embeds credentials, which is not allowed`,
        );
      }

      const host = parsed.hostname.toLowerCase();
      if (!allowed.has(host)) {
        throw netProviderDenial(`host "${host}" is not on the run's allowlist`);
      }

      // Issue #10: resolve-then-pin, closing the DNS-rebinding / private-
      // range SSRF gap a hostname allowlist alone cannot see.
      const pinResult = await pinHostAddress(host, policy, lookup);
      if (!pinResult.ok) {
        throw netProviderDenial(pinResult.reason);
      }

      const response = await issueRequest(
        parsed,
        method,
        body,
        pinResult.pinned,
        maxFetchBytes,
      );

      if (response.status >= 300 && response.status < 400) {
        if (!response.location) {
          throw netProviderDenial(
            'redirect response carried no Location header',
          );
        }
        try {
          currentUrl = new URL(response.location, currentUrl).toString();
        } catch {
          throw netProviderDenial(
            'redirect response carried an unparseable Location header',
          );
        }
        continue;
      }

      return { status: response.status, body: response.body };
    }
    throw netProviderDenial(`exceeded ${MAX_REDIRECTS} redirects`);
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
function createSnapshotCacheProvider(snapshot: Record<string, CacheEntry>): {
  provider: CacheProvider;
  snapshot: () => Record<string, CacheEntry>;
} {
  const store = new Map<string, CacheEntry>(Object.entries(snapshot));
  return {
    provider: {
      async get(key: string): Promise<CacheEntry | undefined> {
        return store.get(key);
      },
      async set(key: string, entry: CacheEntry): Promise<void> {
        store.set(key, entry);
      },
    },
    snapshot: () => Object.fromEntries(store),
  };
}

/**
 * Resolves the `wasmUri` to hand `createLuaExecutor` (forwarded to
 * `@markii/lua`'s `runScript` -> `createEmptyLuaEngine` -> wasmoon's
 * `LuaFactory`). In the BUNDLED extension, `esbuild.config.mjs`'s worker
 * build copies wasmoon's `glue.wasm` next to this file's compiled output
 * (`dist/run/glue.wasm`) specifically so this lookup succeeds; in
 * dev/Vitest (this file run straight from `src/run/`, no copy step has
 * ever run), the file is absent and `undefined` is returned, letting
 * wasmoon fall back to its own default Node resolution (the real
 * `node_modules/wasmoon/dist/glue.wasm`) — see `@markii/lua`'s
 * `createEmptyLuaEngine` doc comment for why `undefined` is always safe to
 * pass here.
 */
function resolveWasmUri(): string | undefined {
  const candidate = path.join(__dirname, 'glue.wasm');
  return existsSync(candidate) ? candidate : undefined;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one job to completion, never throwing — see this module's top doc comment. */
async function runJob(job: RunJob): Promise<RunResult> {
  const cache = createSnapshotCacheProvider(job.cacheSnapshot ?? {});
  const netAllowlist = job.netAllowlist ?? [];
  // The SAME cap governs this worker's own bounded body read
  // (`issueRequest`, B-2) and `@markii/lua`'s own `maxFetchBytes` check —
  // computed once, here, rather than letting each side default
  // independently, so the two can never quietly disagree.
  const maxFetchBytes = job.limits?.maxFetchBytes ?? DEFAULT_MAX_FETCH_BYTES;
  // GitHub issue #10, fail closed: an absent `netPolicy` (an older host, or
  // a caller that hasn't been updated) means restricted addresses are NOT
  // allowed — the same posture `@markii/lua`'s own defaults take, never the
  // opposite.
  const netPolicy: PinPolicy = job.netPolicy ?? {
    allowRestrictedAddresses: false,
  };
  const net = createNetProvider(netAllowlist, maxFetchBytes, netPolicy);

  const tree = parse(job.text);
  const scripts = extractScripts(tree);

  // Slice 2 of the .mkz Run-path arc (GitHub issue #9): a bundle-backed run
  // gets a snapshot-backed ScriptView (never a live zip/disk handle — see
  // `./snapshot-storage.ts`), scoped to exactly the intersection
  // `createScriptView` (@markii/bundle) computes between the manifest's
  // declared `permissions.bundle` and what the host's grant flow actually
  // granted.
  const bundleStorage = job.bundle
    ? createSnapshotStorage(job.bundle.snapshot)
    : undefined;
  const bundleView =
    bundleStorage && job.bundle
      ? createScriptView(bundleStorage, job.bundle.manifest, {
          bundle: job.bundle.grantedBundlePermissions,
        })
      : undefined;

  const executor = createLuaExecutor({
    net,
    // One allowlist governs GET/POST/PATCH alike (B-6, docs/security.md:
    // "the per-host allowlist is the real boundary") — the grant prompt's
    // wording ("can send data to <host>") already promises exactly this,
    // so POST/PATCH must be wired to the same hosts GET is, not silently
    // disabled.
    netGrants: { get: netAllowlist, post: netAllowlist },
    cache: cache.provider,
    bundle: bundleView,
    ...(job.packModules
      ? { packModuleResolver: createPackModuleResolver(job.packModules) }
      : {}),
    maxFetchBytes,
    limits: {
      ...(job.limits?.wallClockMs !== undefined
        ? { wallClockMs: job.limits.wallClockMs }
        : {}),
      ...(job.limits?.maxInstructions !== undefined
        ? { maxInstructions: job.limits.maxInstructions }
        : {}),
      ...(job.limits?.maxMemoryBytes !== undefined
        ? { maxMemoryBytes: job.limits.maxMemoryBytes }
        : {}),
    },
    wasmUri: resolveWasmUri(),
  });

  const store = createValueStore();
  const summary = await runDocumentScripts({
    scripts,
    executor,
    // GitHub issue #11: the trigger the host sent (default `'manual'`) — its
    // mapping to a capability tier (`tierForTrigger`) is the sandbox's own
    // read-only gate for auto/scheduled runs. Never note-influenced.
    trigger: job.trigger ?? 'manual',
    store,
    // `src=scripts/foo.lua` resolution (design point 4): the referenced
    // file's source lives in the snapshot under its own bundle-relative
    // path (`ScriptBlock.src` already carries the full "scripts/..." path
    // — see @markii/core's `scripts.ts`), read through the SAME jailed
    // snapshot storage a script's own `bundle.read` would use. A bare
    // `.mk.md` run (no `job.bundle`) never sets `loadSource` at all, so a
    // `src=` block there is reported as the pre-existing "no loadSource
    // provided" error, unchanged.
    ...(bundleStorage
      ? {
          loadSource: async (src: string) => {
            const bytes = await bundleStorage.read(src);
            if (bytes === undefined) {
              throw new Error(`bundle script "${src}" was not found`);
            }
            return Buffer.from(bytes).toString('utf8');
          },
        }
      : {}),
  });

  // A net-provider policy denial already arrives here classified as
  // 'capability-denied': `@markii/lua` records it on its non-spoofable
  // `CapabilityDenials` handle when the branded `netProviderDenial` crosses
  // its provider-call boundary (see the `NetProvider` doc comment above,
  // P2-c). So `runJob` no longer post-processes any failure kind — it reads
  // `entry.failureKind` verbatim, and the value store already carries the
  // same kind for the corresponding `StoredValue`.
  const failures: RunFailure[] = summary.results
    .filter(
      (entry: RunSummaryEntry): entry is RunSummaryEntry & { error: string } =>
        entry.status === 'error',
    )
    .map((entry) => ({
      name: entry.name,
      message: entry.error ?? 'script failed',
      kind: entry.failureKind ?? 'script-error',
    }));

  // Copied entry-by-entry onto a fresh plain object rather than returned as
  // `store.snapshot()` directly: this preserves the exact N-11 pinned shape
  // (a script literally named `__proto__` assigns through and leaves no own
  // key), which a direct structured-clone of the store's own object would
  // not. The values are otherwise passed through verbatim — failure kinds
  // arrive already correct (see the failures comment above).
  const values: Record<string, import('@markii/runtime').StoredValue> = {};
  for (const [name, entry] of Object.entries(store.snapshot())) {
    values[name] = entry;
  }

  return {
    values,
    failures,
    cacheSnapshot: cache.snapshot(),
    ...(bundleStorage
      ? { cacheOut: cacheFilesFrom(bundleStorage.currentFiles()) }
      : {}),
  };
}

/** Turns any unexpected internal failure into an ordinary result — see the top doc comment's "never an unhandled rejection" guarantee. */
function resultForInternalError(
  err: unknown,
  fallbackCacheSnapshot: Record<string, CacheEntry>,
): RunResult {
  return {
    values: {},
    failures: [
      {
        name: '<document>',
        message: describeThrown(err),
        kind: 'script-error',
      },
    ],
    cacheSnapshot: fallbackCacheSnapshot,
  };
}

const RUN_TRIGGERS: ReadonlySet<string> = new Set([
  'manual',
  'auto',
  'scheduled',
]);

function isRunJob(value: unknown): value is RunJob {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  // `trigger` is optional, but a PRESENT one must be a known trigger — a
  // malformed job is rejected outright (fail-closed) rather than silently
  // coerced, so a bad `trigger` can never quietly fall through to the
  // full-capability `'manual'` default. Only the trusted host sets this, but
  // validating it keeps the tier gate's input honest regardless.
  if (
    Object.prototype.hasOwnProperty.call(job, 'trigger') &&
    job.trigger !== undefined &&
    (typeof job.trigger !== 'string' || !RUN_TRIGGERS.has(job.trigger))
  ) {
    return false;
  }
  // Same fail-closed shape check for `netPolicy` (GitHub issue #10): a
  // PRESENT but malformed policy is rejected outright rather than silently
  // falling through to the safe default, keeping the pinning gate's input
  // as honest as the tier gate's above.
  if (
    Object.prototype.hasOwnProperty.call(job, 'netPolicy') &&
    job.netPolicy !== undefined &&
    (typeof job.netPolicy !== 'object' ||
      job.netPolicy === null ||
      typeof (job.netPolicy as Record<string, unknown>)
        .allowRestrictedAddresses !== 'boolean')
  ) {
    return false;
  }
  return (
    typeof job.text === 'string' &&
    Array.isArray(job.netAllowlist) &&
    job.netAllowlist.every((h) => typeof h === 'string') &&
    typeof job.cacheSnapshot === 'object' &&
    job.cacheSnapshot !== null
  );
}

async function main(): Promise<void> {
  if (!parentPort) {
    // Not actually running as a worker thread (e.g. required directly by
    // mistake) — nothing to do, and nothing to post a result to.
    return;
  }
  const port = parentPort;

  port.once('message', (message: unknown) => {
    void (async () => {
      if (!isRunJob(message)) {
        port.postMessage(
          resultForInternalError(
            new Error('worker received a malformed job message'),
            {},
          ),
        );
        return;
      }
      try {
        const result = await runJob(message);
        port.postMessage(result);
      } catch (err) {
        port.postMessage(
          resultForInternalError(err, message.cacheSnapshot ?? {}),
        );
      }
    })();
  });
}

void main();
