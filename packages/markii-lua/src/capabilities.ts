import type { ScriptView } from '@markii/bundle';
import { CAPABILITY_ERROR_TAG } from './errors.js';

/** A GET/POST/PATCH result handed back to Lua as `{status=..., body=...}`. */
export interface NetResponse {
  status: number;
  body: string;
}

/**
 * Host-provided network primitive. The runtime never imports a global
 * `fetch` or reaches the network on its own — this is injected by the
 * host, which is where SSRF/allowlist policy actually lives (spec §10).
 * `net.fetch_json`/`net.post`/`net.patch` below are a thin, capability- and
 * size-checked Lua-facing wrapper around whatever `provider` does.
 */
export interface NetProvider {
  get(url: string): Promise<NetResponse>;
  post?(url: string, body: string): Promise<NetResponse>;
  patch?(url: string, body: string): Promise<NetResponse>;
}

/** One cached entry: the stored value plus when it was stored, for TTL comparison. */
export interface CacheEntry {
  value: unknown;
  storedAtMs: number;
}

/**
 * Host-provided cache primitive backing `cache.get(key, ttl, fn)`. Real
 * persistence (bundle `cache/`, IndexedDB, whatever the host uses) is the
 * host's concern; this package only defines the read-if-fresh-else-run-fn
 * contract.
 */
export interface CacheProvider {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

/** Spec §8's two-tier gate. `'manual'` = explicit run/run-all click, all grants apply. `'auto'` = on-open or scheduled, read-only regardless of what was granted. */
export type CapabilityTier = 'manual' | 'auto';

/**
 * Hostnames this run may reach, ALREADY intersected by the caller (manifest
 * ∩ user grant — same pattern as `@markii/bundle`'s `createScriptView`, DEFECT
 * 10). This module does not re-derive grants from a manifest; it trusts
 * `get`/`post` as the final, effective allowlist for this one run.
 */
export interface NetGrants {
  get: readonly string[];
  post: readonly string[];
}

export interface CapabilityConfig {
  tier: CapabilityTier;
  net?: NetProvider;
  netGrants?: NetGrants;
  cache?: CacheProvider;
  /** Bundle-scoped filesystem view (spec §11) — already capability-restricted by `@markii/bundle`'s `createScriptView`; this module delegates to it, never re-implements the path-jail or write policy. */
  bundle?: ScriptView;
  maxFetchBytes?: number;
}

export const DEFAULT_MAX_FETCH_BYTES = 2_000_000;

/** One genuine capability denial, as recorded by `buildCapabilities`' `denials` handle — see its doc comment. */
export interface CapabilityDenial {
  reason: 'denied' | 'tier-blocked';
  message: string;
}

/**
 * Non-spoofable, out-of-band record of the LAST genuine capability denial
 * that happened during one `buildCapabilities` call's lifetime (i.e. one
 * `runScript` call — see `./sandbox`). This is a plain JS closure: no Lua
 * value, no metatable, nothing a script running in the sandbox can ever
 * read or write, mirroring the discipline `./limits`' breach flag already
 * uses for resource-limit kills. `sandbox.ts`'s `classifyRuntimeError`
 * consults `last()` — never any error message string that crossed the Lua
 * boundary — to decide whether a failed run was genuinely a `'capability'`
 * kind, and if so which `capability` flavor (`'denied'` vs `'tier-blocked'`).
 */
export interface CapabilityDenials {
  last(): CapabilityDenial | undefined;
}

function capabilityError(message: string): Error {
  return new Error(`${CAPABILITY_ERROR_TAG}: ${message}`);
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bare hostname from a URL string, or `undefined` if the URL doesn't parse. */
function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * `Uint8Array` <-> Lua string, byte-for-byte via one JS UTF-16 code unit
 * per byte (Latin-1-style). Lua strings are themselves 8-bit-clean byte
 * arrays, but wasmoon's own JS<->Lua marshaling for strings does NOT
 * preserve embedded NUL (0x00) bytes end-to-end — verified empirically
 * (wasmoon 1.16.0): a JS string or Lua `string.char(...)` value containing
 * a `\0` is truncated at the first NUL by the time it crosses the
 * boundary, in BOTH directions (`global.set`, and a Lua value passed as an
 * argument to a host function). This is a real, currently-unclosed gap for
 * binary asset data containing NUL bytes (some binary formats do; JSON
 * cache payloads and Lua source — the two documented `bundle.*` use cases
 * per spec §9/§11 — do not). Documented here rather than silently
 * "handled": `bundle.read`/`bundle.write` should be treated as reliable
 * for text/JSON payloads and NOT YET reliable for arbitrary binary
 * containing NUL bytes. See the adversarial test asserting this exact
 * (current, imperfect) behavior so a future wasmoon upgrade that fixes it
 * is a visible, reviewed diff rather than a silent behavior change.
 */
export function bytesToLuaString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

export function luaStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Builds the raw, host-facing async functions to inject as flat globals,
 * and the trusted Lua prelude that wraps them into the ergonomic `net` /
 * `cache` / `bundle` tables the docs/spec.md host API documents (`net.fetch_json(url)`,
 * `cache.get(key, ttl, fn)`, `bundle.read/write/exists(path)`).
 *
 * ## Why "raw flat globals + a Lua prelude" instead of `global.set('net', {...})`
 *
 * The natural-looking approach — `engine.global.set('net', { fetch_json:
 * async (url) => ... })` — silently breaks async/await for any capability
 * whose Lua-facing wrapper needs to be REPLACED with a Lua closure later
 * (which `cache.get` and every `:await()`-wrapping function here need to
 * be, since raw host functions return promises that must be explicitly
 * awaited — see below). With wasmoon's default `enableProxy: true`, a
 * plain JS object passed to `global.set` becomes a live PROXY table: Lua
 * writes to it round-trip back through JS, and reading a Lua-defined
 * function back OUT of that proxy re-wraps it as a synchronous JS-callable
 * bridge (`lua_pcallk`), which cannot yield. Concretely: assigning
 * `cache.get = function(...) ... end` onto a proxied table and then
 * calling `cache.get(...)` from a script ends up invoking that Lua
 * function through the SYNCHRONOUS bridge, and if it (or anything it
 * calls) tries to `:await()` a promise, Lua raises "attempt to yield
 * across a C-call boundary" — verified empirically. Using genuine,
 * Lua-native tables (built with `{}` inside the prelude, never JS-backed)
 * avoids this entirely: every read/write of `net`/`cache`/`bundle` after
 * setup is a normal Lua table operation, no JS round trip involved.
 *
 * ## Why raw calls need `:await()` at all
 *
 * A JS async function called from Lua does NOT automatically suspend the
 * calling coroutine — wasmoon marshals its Promise into Lua as a
 * `js_promise` userdata with `:await()`/`:next()`/`:catch()` methods; the
 * CALLER must explicitly invoke `:await()` to get the resolved value
 * (verified empirically: without it, a script sees the raw promise
 * userdata, not the awaited result). Since `docs/spec.md`'s example script
 * (`local repo = net.fetch_json(url)`) is written as if this were
 * synchronous, the awaiting is done for the author, once, HERE — inside
 * the prelude's Lua wrapper — never exposed to the untrusted script.
 *
 * Each raw handle is captured into a `local` inside the prelude and the
 * matching global is set to `nil` immediately after, so it is not
 * reachable as a global by the untrusted script that runs afterward (only
 * the ergonomic wrapper closures, which close over the local, remain
 * callable).
 */
export function buildCapabilities(config: CapabilityConfig): {
  rawGlobals: Record<string, (...args: never[]) => Promise<unknown>>;
  preludeLua: string;
  denials: CapabilityDenials;
} {
  const maxFetchBytes = config.maxFetchBytes ?? DEFAULT_MAX_FETCH_BYTES;
  const rawGlobals: Record<string, (...args: never[]) => Promise<unknown>> = {};
  const preludeParts: string[] = [];

  // Out-of-band denial record — see `CapabilityDenials`'s doc comment. Every
  // site below that throws a `capabilityError` records here FIRST, so
  // `sandbox.ts` can classify the failure by this JS-only signal instead of
  // by re-reading the (script-forgeable) error message.
  let lastDenial: CapabilityDenial | undefined;
  function recordDenial(
    reason: CapabilityDenial['reason'],
    message: string,
  ): void {
    lastDenial = { reason, message };
  }
  const denials: CapabilityDenials = { last: () => lastDenial };

  // --- net --------------------------------------------------------------
  // `fetch_json` and `post`/`patch` are gated INDEPENDENTLY of each other
  // (a manifest can grant POST to a host without granting it GET, or vice
  // versa), so the `net` table and each method are wired up separately
  // rather than behind one combined condition — an earlier version of
  // this function nested POST/PATCH wiring inside "if GET is granted",
  // which silently produced no `net.post` at all for a POST-only grant.
  const netGrants = config.netGrants ?? { get: [], post: [] };
  // NOTE: no longer conditioned on `config.tier === 'manual'` for the POST
  // half — under 'auto' with POST hosts granted, `net.post`/`net.patch` are
  // now wired to TIER-BLOCKED STUBS below (not left undefined), so the
  // `net` table itself must exist for those stubs to attach to.
  const netTableNeeded =
    config.net !== undefined &&
    (netGrants.get.length > 0 || netGrants.post.length > 0);

  if (netTableNeeded) {
    preludeParts.push('net = net or {}\n');
  }

  if (config.net && netGrants.get.length > 0) {
    rawGlobals.__smd_net_get_raw = (async (url: string) => {
      const host = hostnameOf(url);
      if (!host || !netGrants.get.includes(host)) {
        const message = `net access to host "${host ?? url}" not granted for GET`;
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      const res = await config.net!.get(url);
      if (res.body.length > maxFetchBytes) {
        const message = `fetch response for "${url}" exceeds the ${maxFetchBytes}-byte cap`;
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        const message = `fetch response for "${url}" was not valid JSON`;
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      return parsed;
    }) as (...args: never[]) => Promise<unknown>;

    preludeParts.push(`
local __smd_net_get = __smd_net_get_raw
__smd_net_get_raw = nil
net.fetch_json = function(url) return __smd_net_get(url):await() end
`);
  }

  // POST/PATCH are effectful. Under the 'manual' tier, wired to the real
  // provider for hosts the effective grant set allows for POST. Under
  // 'auto', even when POST hosts ARE granted, they are wired to STUBS
  // that record a 'tier-blocked' denial and throw WITHOUT EVER reaching
  // `config.net.post`/`.patch` — this grants nothing new (the provider is
  // never called), it only makes "granted but tier-forbidden" a
  // classifiable, non-spoofable outcome instead of collapsing into an
  // ordinary "attempt to call a nil value" runtime error (spec §8: "An
  // effectful call under an auto trigger fails cleanly").
  if (
    config.tier === 'manual' &&
    config.net?.post &&
    netGrants.post.length > 0
  ) {
    rawGlobals.__smd_net_post_raw = (async (url: string, body: string) => {
      const host = hostnameOf(url);
      if (!host || !netGrants.post.includes(host)) {
        const message = `net access to host "${host ?? url}" not granted for POST`;
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      return config.net!.post!(url, body);
    }) as (...args: never[]) => Promise<unknown>;
    preludeParts.push(`
local __smd_net_post = __smd_net_post_raw
__smd_net_post_raw = nil
net.post = function(url, body) return __smd_net_post(url, body):await() end
`);
  } else if (
    // Mirrors the 'manual' condition above EXACTLY except for the tier, so
    // the read-only tier never exposes a wider method surface than the
    // full-grant tier would: a stub appears only where a real `net.post`
    // would have appeared under 'manual'. Without the `config.net?.post`
    // half, a host whose provider implements no POST at all would still
    // show `net.post` under 'auto' (as a tier-block stub) while showing
    // nothing under 'manual' — an inconsistency a feature-detecting script
    // (`if net.post then`) would read exactly backwards.
    config.tier === 'auto' &&
    config.net?.post &&
    netGrants.post.length > 0
  ) {
    rawGlobals.__smd_net_post_tier_blocked_raw = (async () => {
      const message =
        'net.post is granted but not permitted under the read-only auto tier (requires a manual run)';
      recordDenial('tier-blocked', message);
      throw capabilityError(message);
    }) as (...args: never[]) => Promise<unknown>;
    preludeParts.push(`
local __smd_net_post_blocked = __smd_net_post_tier_blocked_raw
__smd_net_post_tier_blocked_raw = nil
net.post = function(url, body) return __smd_net_post_blocked(url, body):await() end
`);
  }

  if (
    config.tier === 'manual' &&
    config.net?.patch &&
    netGrants.post.length > 0
  ) {
    rawGlobals.__smd_net_patch_raw = (async (url: string, body: string) => {
      const host = hostnameOf(url);
      if (!host || !netGrants.post.includes(host)) {
        const message = `net access to host "${host ?? url}" not granted for PATCH`;
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      return config.net!.patch!(url, body);
    }) as (...args: never[]) => Promise<unknown>;
    preludeParts.push(`
local __smd_net_patch = __smd_net_patch_raw
__smd_net_patch_raw = nil
net.patch = function(url, body) return __smd_net_patch(url, body):await() end
`);
  } else if (
    // Same mirroring as the POST stub above — see its comment.
    config.tier === 'auto' &&
    config.net?.patch &&
    netGrants.post.length > 0
  ) {
    rawGlobals.__smd_net_patch_tier_blocked_raw = (async () => {
      const message =
        'net.patch is granted but not permitted under the read-only auto tier (requires a manual run)';
      recordDenial('tier-blocked', message);
      throw capabilityError(message);
    }) as (...args: never[]) => Promise<unknown>;
    preludeParts.push(`
local __smd_net_patch_blocked = __smd_net_patch_tier_blocked_raw
__smd_net_patch_tier_blocked_raw = nil
net.patch = function(url, body) return __smd_net_patch_blocked(url, body):await() end
`);
  }

  // --- cache --------------------------------------------------------------
  // cache.get is implemented ENTIRELY IN LUA (see the prelude below),
  // calling the script-provided `fn` as a normal Lua-to-Lua call. This is
  // deliberate, not just tidy: `fn` may itself call `net.fetch_json`
  // (which needs to `:await()`), and a Lua function invoked FROM JS
  // (rather than from Lua) goes through the same non-yieldable
  // `lua_pcallk` bridge described above — so `cache.get`'s JS side only
  // ever exposes plain read/write primitives (`__smd_cache_get_raw`,
  // `__smd_cache_set_raw`); the read-if-fresh-else-run-fn CONTROL FLOW is
  // Lua calling Lua, never JS calling Lua.
  if (config.cache) {
    rawGlobals.__smd_cache_get_raw = (async (key: string) =>
      config.cache!.get(key)) as (...args: never[]) => Promise<unknown>;
    rawGlobals.__smd_cache_set_raw = (async (
      key: string,
      value: unknown,
      storedAtMs: number,
    ) => {
      await config.cache!.set(key, { value, storedAtMs });
      return true;
    }) as (...args: never[]) => Promise<unknown>;
    // `now` (for TTL freshness) is computed in JS, once per cache.get
    // call, and handed to Lua as a plain number argument — there is no
    // `os.time()` in this sandbox (§10: no `os` library at all), so the
    // clock is a host-provided value, not a Lua-reachable ambient
    // capability.
    rawGlobals.__smd_now_ms_raw = (async () => Date.now()) as (
      ...args: never[]
    ) => Promise<unknown>;

    preludeParts.push(`
local __smd_cache_get = __smd_cache_get_raw
local __smd_cache_set = __smd_cache_set_raw
local __smd_now_ms = __smd_now_ms_raw
__smd_cache_get_raw = nil
__smd_cache_set_raw = nil
__smd_now_ms_raw = nil
cache = cache or {}
cache.get = function(key, ttl, fn)
  local existing = __smd_cache_get(key):await()
  if existing ~= nil then
    local now = __smd_now_ms():await()
    if (now - existing.storedAtMs) < (ttl * 1000) then
      return existing.value
    end
  end
  local value = fn()
  __smd_cache_set(key, value, __smd_now_ms():await()):await()
  return value
end
`);
  }

  // --- bundle -------------------------------------------------------------
  // Delegates entirely to the injected `ScriptView` (`@markii/bundle`), which
  // already enforces the path-jail and the read/write:cache/ split (spec
  // §11). This module adds nothing on top except the tier gate for
  // `bundle.write` (a tier-blocked stub under 'auto' — read-only tier) and
  // the byte<->Lua-string conversion.
  if (config.bundle) {
    const view = config.bundle;
    // `ScriptView` (@markii/bundle) throws its own `ScriptCapabilityError` /
    // `BundlePathError` for a denied or path-jail-violating call — those
    // are re-tagged here with `CAPABILITY_ERROR_TAG` (a cosmetic prefix
    // only, see `./errors`'s doc comment) AND recorded on the `denials`
    // handle as reason `'denied'`, so `sandbox.ts` reports them as
    // `kind: 'capability', capability: 'denied'` uniformly, the same as a
    // net host-allowlist denial, rather than falling through to the
    // generic `'runtime'` bucket.
    rawGlobals.__smd_bundle_read_raw = (async (path: string) => {
      let data: Uint8Array | undefined;
      try {
        data = await view.read(path);
      } catch (err) {
        const message = describeThrown(err);
        recordDenial('denied', message);
        throw capabilityError(message);
      }
      return data === undefined ? null : bytesToLuaString(data);
    }) as (...args: never[]) => Promise<unknown>;
    rawGlobals.__smd_bundle_exists_raw = (async (path: string) => {
      try {
        return await view.exists(path);
      } catch (err) {
        const message = describeThrown(err);
        recordDenial('denied', message);
        throw capabilityError(message);
      }
    }) as (...args: never[]) => Promise<unknown>;

    preludeParts.push(`
local __smd_bundle_read = __smd_bundle_read_raw
local __smd_bundle_exists = __smd_bundle_exists_raw
__smd_bundle_read_raw = nil
__smd_bundle_exists_raw = nil
bundle = bundle or {}
bundle.read = function(path) return __smd_bundle_read(path):await() end
bundle.exists = function(path) return __smd_bundle_exists(path):await() end
`);

    if (config.tier === 'manual') {
      rawGlobals.__smd_bundle_write_raw = (async (
        path: string,
        data: string,
      ) => {
        try {
          await view.write(path, luaStringToBytes(data));
        } catch (err) {
          const message = describeThrown(err);
          recordDenial('denied', message);
          throw capabilityError(message);
        }
        return true;
      }) as (...args: never[]) => Promise<unknown>;
      preludeParts.push(`
local __smd_bundle_write = __smd_bundle_write_raw
__smd_bundle_write_raw = nil
bundle.write = function(path, data) return __smd_bundle_write(path, data):await() end
`);
    } else {
      // Under 'auto': `bundle.write` is wired to a TIER-BLOCKED STUB that
      // records a 'tier-blocked' denial and throws WITHOUT EVER reaching
      // `view.write` — the bundle view's own write path is never touched,
      // so this grants nothing new; it only makes "write is available but
      // this tier forbids it" classifiable instead of collapsing into an
      // ordinary "attempt to call a nil value" runtime error (spec §8:
      // "bundle/cache reads, cache writes only" under the read-only tier).
      rawGlobals.__smd_bundle_write_tier_blocked_raw = (async () => {
        const message =
          'bundle.write is not permitted under the read-only auto tier (requires a manual run)';
        recordDenial('tier-blocked', message);
        throw capabilityError(message);
      }) as (...args: never[]) => Promise<unknown>;
      preludeParts.push(`
local __smd_bundle_write_blocked = __smd_bundle_write_tier_blocked_raw
__smd_bundle_write_tier_blocked_raw = nil
bundle.write = function(path, data) return __smd_bundle_write_blocked(path, data):await() end
`);
    }
  }

  return { rawGlobals, preludeLua: preludeParts.join('\n'), denials };
}
