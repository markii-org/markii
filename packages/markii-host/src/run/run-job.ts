/**
 * The engine-neutral half of a run: everything between "a job arrived" and
 * "here is its result", with nothing in it that binds to one JavaScript
 * runtime.
 *
 * This exists because the two hosts cannot spawn the same kind of isolate
 * (see `./isolate.ts`). The VS Code extension runs a `node:worker_threads`
 * worker; an Obsidian plugin, living in an Electron renderer, can only run
 * a Web Worker, where `node:http`, `node:dns`, and `Buffer` do not exist.
 * Rather than keep two copies of the run logic in step with each other,
 * the parts that genuinely differ are injected: how a network request is
 * made, and where wasmoon's `glue.wasm` is found.
 *
 * `./worker-entry.ts` supplies the Node ones (a pinned `node:https`
 * request, `glue.wasm` beside the bundle on disk).
 * `./worker-entry-browser.ts` supplies the Web Worker ones (a request
 * bridged to the host over `postMessage`, `glue.wasm` as a blob URL).
 * Everything below runs identically under both, which is the point: the
 * sandbox, the tier gate, the marshaling limits, and the failure
 * classification cannot drift between hosts, because there is only one of
 * each.
 */
import { extractScripts, parse } from '@markii/core';
import {
  buildDirectiveListing,
  createValueStore,
  runDocumentScripts,
  type FailureKind,
  type RunSummaryEntry,
  type RunTrigger,
  type StoredValue,
} from '@markii/runtime';
import {
  createLuaExecutor,
  DEFAULT_MAX_FETCH_BYTES,
  type CacheEntry,
  type CacheProvider,
  type NetProvider,
} from '@markii/lua';
import type { BundleFsGrant, BundleManifest } from '@markii/bundle';
import { createScriptView } from '@markii/bundle';
import { cacheFilesFrom } from './bundle-run.js';
import { createSnapshotStorage } from './snapshot-storage.js';
import { createPackModuleResolver } from './lua-resolver.js';
import type { PackModulesMap } from './lua-resolver.js';
import type { PinPolicy } from './net-pinning.js';
// The message shape and its guard live apart from this module because a
// host bundle must import the guard WITHOUT importing `@markii/lua` — see
// `./run-progress.ts`'s doc comment.
import type { RunProgress } from './run-progress.js';

export type { RunProgress } from './run-progress.js';
export { isRunProgress } from './run-progress.js';

/**
 * What a runtime must supply for `runJob` to work there.
 *
 * `createNet` receives the SAME arguments the Node provider always took,
 * so a browser implementation cannot quietly widen the allowlist or the
 * fetch cap: both are handed to it, and `@markii/lua` enforces its own
 * copy of the cap independently regardless.
 */
export interface RunJobDeps {
  createNet: (
    netAllowlist: string[],
    maxFetchBytes: number,
    netPolicy: PinPolicy,
  ) => NetProvider;
  /** Where wasmoon should load `glue.wasm` from; `undefined` lets it use its own default resolution. */
  wasmUri: string | undefined;
  /**
   * Posts one per-script progress message back to the host (GitHub issue
   * #35). Supplied by each worker entry so BOTH isolates emit the identical
   * message: the shape, the ordinal, and the moment it is sent are decided
   * here, and the entry only knows how to put a message on its own channel
   * (`parentPort.postMessage` for the Node worker thread,
   * `self.postMessage` for the Web Worker).
   *
   * Optional so an entry that has not been updated simply reports nothing
   * during a run and its final result is unchanged.
   */
  postProgress?: (message: RunProgress) => void;
}

/** The one job message this worker ever receives, posted once by `run-host.ts`. */
export interface RunJob {
  text: string;
  /**
   * How this run was triggered (GitHub issue #11). Passed straight to
   * `runDocumentScripts`, whose `tierForTrigger` (`@markii/runtime`) is THE
   * SECURITY GATE: `'manual'` runs at the full capability tier, while
   * `'auto'` and `'scheduled'` are forced to the read-only tier (GET,
   * cache and bundle reads, cache writes — never POST/PATCH/bundle-write)
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
  values: Record<string, StoredValue>;
  failures: RunFailure[];
  /** The mutated cache state, to be persisted by the host for the next run. */
  cacheSnapshot: Record<string, CacheEntry>;
  /**
   * Present only when `RunJob.bundle` was set: the FULL, post-run contents
   * of the bundle snapshot's `.cache/` subtree (not a diff) — the host
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
 * `hostname` with IPv6 brackets stripped, for the `hostname` option
 * `http.request`/`https.request` take: Node re-adds the brackets itself
 * (for the `Host` header and TLS SNI) whenever the raw address contains a
 * `:`, so passing an already-bracketed literal through would double them.
 */
/** A `CacheProvider` over a plain snapshot object, with the writes it accumulates readable back out. */
function createSnapshotCacheProvider(snapshot: Record<string, CacheEntry>): {
  provider: CacheProvider;
  snapshot: () => Record<string, CacheEntry>;
} {
  const store: Record<string, CacheEntry> = { ...snapshot };
  return {
    provider: {
      get: (key: string) => Promise.resolve(store[key]),
      set: (key: string, entry: CacheEntry) => {
        store[key] = entry;
        return Promise.resolve();
      },
    },
    snapshot: () => ({ ...store }),
  };
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one job to completion, never throwing — see this module's top doc comment. */
export async function runJob(
  job: RunJob,
  deps: RunJobDeps,
): Promise<RunResult> {
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
  const net = deps.createNet(netAllowlist, maxFetchBytes, netPolicy);

  const tree = parse(job.text);
  const scripts = extractScripts(tree);
  // GitHub issue #33: the note's own directives, as capped plain data for
  // the `doc` table a script sees. Built from the tree ALREADY parsed on
  // the line above, so a run still parses the note exactly once, and built
  // HERE rather than in either host so both isolates (the Node worker and
  // the Web Worker) get a listing produced by one piece of code.
  const directives = buildDirectiveListing(tree);

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
    wasmUri: deps.wasmUri,
  });

  const store = createValueStore();
  // GitHub issue #35: the ordinal is assigned HERE rather than by either
  // worker entry, so the two hosts cannot number their runs differently.
  let progressIndex = 0;
  const postProgress = deps.postProgress;
  const summary = await runDocumentScripts({
    scripts,
    executor,
    // Announced per script, in document order, as each value is stored —
    // `runDocumentScripts` swallows anything this throws, so a failing
    // channel costs the run nothing.
    ...(postProgress
      ? {
          onValue: (name: string, value: StoredValue) => {
            postProgress({
              kind: 'markii:run-progress',
              index: progressIndex++,
              name,
              value,
            });
          },
        }
      : {}),
    // GitHub issue #11: the trigger the host sent (default `'manual'`) — its
    // mapping to a capability tier (`tierForTrigger`) is the sandbox's own
    // read-only gate for auto/scheduled runs. Never note-influenced.
    trigger: job.trigger ?? 'manual',
    store,
    // Read-only and tier-free: the listing is the note's own content, so
    // it is handed to an auto/scheduled run exactly as to a manual one.
    doc: { directives },
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
            return new TextDecoder().decode(bytes);
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
  const values: Record<string, StoredValue> = {};
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
export function resultForInternalError(
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

export function isRunJob(value: unknown): value is RunJob {
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
