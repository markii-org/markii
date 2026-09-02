/**
 * Slice 2 of the `.mkz` Run-path arc (GitHub issue #9's locked design
 * comment): the host-side pieces that turn a bundle's `@markii/bundle`
 * `BundleStorage` into the SNAPSHOT a worker run is handed, and back a
 * worker's `.cache/` output into something the host can persist. Kept
 * `vscode`-free, like every other module under `./run` — `preview-panel.ts`
 * (the only file allowed to import `vscode` alongside `extension.ts`)
 * supplies the actual `BundleStorage`/`Memento`/filesystem calls.
 *
 * ## Why a snapshot at all
 *
 * The worker is a separate `worker_thread` and must never hold a live
 * handle to a zip archive or the user's disk (docs/security.md's isolate
 * requirement, restated in issue #9's design comment) — so the host reads
 * whatever a run may legitimately touch into plain bytes BEFORE spawning
 * the worker, and the worker's `@markii/bundle` `ScriptView` is backed by
 * that in-memory snapshot alone (`./snapshot-storage.ts`), never by the
 * real storage.
 *
 * ## What's in the snapshot
 *
 * The design comment scopes this to "the `scripts/` tree, the subset of
 * `assets/` reachable, and current `.cache/` contents" — deliberately NOT
 * `manifest.json` or the document itself, even though `@markii/bundle`'s
 * `ScriptView.read` places no path restriction on a granted read (only
 * `write` is jailed to `.cache/`). A script that specifically wants to
 * introspect its own manifest or document text cannot do so through
 * `bundle.read` in this slice — `bundle.read("manifest.json")` comes back
 * `undefined`, indistinguishable from "no such file", exactly like any
 * other path the snapshot didn't collect (AGENTS.md's cleanliness
 * principle: a quiet miss, never a special-cased error). This is a
 * deliberate scope line for this slice, not an oversight — flagged in the
 * slice's own report rather than silently widened.
 *
 * ## Consent unification (SECURITY-RELEVANT)
 *
 * Two rules this module and its callers (`./run-flow.ts`, `./grant-flow.ts`)
 * now hold to, so a bundle's consent story matches a bare `.mk.md`
 * document's exactly:
 *
 * - `manifestNetHosts` (the manifest's `permissions.net` declaration) is
 *   never merged into what a run prompts for. The static scan
 *   (`./script-requirements.ts`) is the only source of prompted hostnames,
 *   for a bundle too — see `netDeclarationDiagnostics` below for how a
 *   mismatch is surfaced instead.
 * - The `bundle` capability (`permissions.bundle`) needs no user-facing
 *   prompt at all: `@markii/bundle`'s path-jail confines every read to the
 *   snapshot and every write to `.cache/`, and the read-only tier for
 *   auto/scheduled triggers blocks `bundle.write` outright regardless of
 *   what the manifest declares. `manifestBundleFsGrants`'s result is passed
 *   straight through as the run's granted bundle-fs permissions — see
 *   `./run-flow.ts`.
 */
import type { BundleManifest, BundleStorage } from '@markii/bundle';
import type { BundleFsGrant } from '@markii/bundle';
import type { GrantClosureScript } from '@markii/runtime';

/** The three bundle-relative prefixes a run's snapshot ever collects — see this module's top doc comment. */
const SNAPSHOT_PREFIXES = ['scripts/', '.cache/', 'assets/'] as const;

/**
 * Total byte budget for one run's bundle snapshot (across `scripts/` +
 * `.cache/` + `assets/` combined). Mirrors the same order of magnitude as
 * `bundle-resolve.ts`'s `DEFAULT_MAX_EMBEDDED_ASSET_BYTES` (20MB) — a
 * personal note bundle's scripts and cache are typically tiny; this budget
 * exists so a hostile or oversized bundle degrades quietly (files beyond
 * the cap are simply absent from the snapshot, exactly like a path the
 * snapshot never collected) rather than exhausting worker/host memory or
 * ballooning the `postMessage` structured-clone payload.
 */
export const DEFAULT_MAX_BUNDLE_SNAPSHOT_BYTES = 20 * 1024 * 1024;

/**
 * Per-file cap applied on top of the total budget (C-1, PENTEST-REPORT
 * follow-up): a single huge file could otherwise consume the ENTIRE total
 * budget by itself, and — before this fix — would be read into memory in
 * full before the total-budget check ever saw it. Sized the same as the
 * total budget by default; a caller wanting a stricter per-file limit can
 * override it independently via `maxFileBytes`.
 */
export const DEFAULT_MAX_BUNDLE_SNAPSHOT_FILE_BYTES =
  DEFAULT_MAX_BUNDLE_SNAPSHOT_BYTES;

export interface BuildBundleSnapshotOptions {
  readonly maxTotalBytes?: number;
  readonly maxFileBytes?: number;
}

export interface BundleSnapshotResult {
  /** Bundle-relative path -> file bytes, ready to hand to `spawnRun`'s `bundle.snapshot`. */
  readonly files: Record<string, Uint8Array>;
  /** `true` when at least one otherwise-eligible file was left out because the budget was reached — a quiet degrade, never a thrown error. */
  readonly truncated: boolean;
}

/**
 * Reads every file under `scripts/`, `.cache/`, and `assets/` out of
 * `storage`, up to `maxTotalBytes` total. `storage.list()` already returns
 * paths sorted, so which files get dropped once the budget is hit is
 * deterministic rather than depending on iteration order.
 */
export async function buildBundleSnapshot(
  storage: BundleStorage,
  options: BuildBundleSnapshotOptions = {},
): Promise<BundleSnapshotResult> {
  const maxTotalBytes =
    options.maxTotalBytes ?? DEFAULT_MAX_BUNDLE_SNAPSHOT_BYTES;
  const maxFileBytes =
    options.maxFileBytes ?? DEFAULT_MAX_BUNDLE_SNAPSHOT_FILE_BYTES;

  const allPaths = await storage.list();
  const eligible = allPaths.filter((path) =>
    SNAPSHOT_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );

  const files: Record<string, Uint8Array> = {};
  let total = 0;
  let truncated = false;

  for (const path of eligible) {
    // C-1: consult `size()` BEFORE ever calling `read()` — a file whose
    // declared size alone would blow the per-file or remaining total budget
    // is skipped without materializing its bytes at all, which is the whole
    // point: a host-side `readFile` of a multi-gigabyte file (directory
    // form) would otherwise allocate that much in the extension host before
    // any cap ever saw it. `size()` returning `undefined` (path vanished
    // between `list()` and here, or the storage form has no size for it) is
    // treated exactly like the file being absent: a quiet skip, never a
    // fallback to reading it blind.
    const size = await storage.size(path);
    if (size === undefined) continue;
    if (size > maxFileBytes || total + size > maxTotalBytes) {
      truncated = true;
      continue;
    }

    const bytes = await storage.read(path);
    if (bytes === undefined) continue;
    // Defense in depth: re-check the actual byte length against the budget.
    // A well-behaved `BundleStorage` never disagrees between `size()` and
    // `read()`, but the total-budget accounting below must never trust
    // `size()` blindly if it ever did.
    if (total + bytes.length > maxTotalBytes) {
      truncated = true;
      continue;
    }
    total += bytes.length;
    files[path] = bytes;
  }

  return { files, truncated };
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * F-1 fix: the `bundleModules` half of the grant closure `computeGrantKey`
 * (`@markii/runtime`) hashes — resolved from `snapshot` (the same in-memory
 * bundle snapshot a run's `ScriptView` is backed by, see this module's top
 * doc comment) rather than left empty.
 *
 * Before this fix, `grant-flow.ts`'s `closureFrom` always passed
 * `bundleModules: {}`, so a `src=scripts/etl.lua` block's `code` was `""`
 * (@markii/core's `ScriptBlock` leaves it empty for a `src=` reference — the
 * actual source lives in the referenced file) and the grant key never
 * reflected that file's bytes at all: swapping the file's contents while
 * the note's own text stayed byte-identical re-ran new code under an old,
 * un-reprompted grant.
 *
 * Only `src=` targets are resolved here — `require()` (bundle-local or
 * pack) stays unwired for the whole `.mkz` Run-path arc (see
 * `grant-flow.ts`'s top doc comment), so a script's closure has no other
 * bundle-local code to fold in yet. A `src=` path missing from `snapshot`
 * (file deleted, or dropped by `buildBundleSnapshot`'s own budget) is
 * simply omitted from the result — never thrown — so a note whose script
 * references a missing file still gets a (now-narrower, but well-defined)
 * grant key instead of failing the whole grant flow.
 */
export function bundleModulesFromSnapshot(
  scripts: readonly GrantClosureScript[],
  snapshot: Record<string, Uint8Array>,
): Record<string, string> {
  const modules: Record<string, string> = {};
  for (const script of scripts) {
    if (script.src === undefined) continue;
    const bytes = snapshot[script.src];
    if (bytes === undefined) continue;
    modules[script.src] = utf8Decoder.decode(bytes);
  }
  return modules;
}

/** Every `.cache/`-prefixed entry in `files`, unchanged — the shape a worker's `RunResult.cacheOut` carries back and a host persists. */
export function cacheFilesFrom(
  files: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith('.cache/')) out[path] = bytes;
  }
  return out;
}

/**
 * Overlays `persisted` (a prior run's `.cache/` output, read back from
 * wherever the host keeps it) onto `base` (a freshly built snapshot),
 * persisted entries winning on a path collision — the "seed the next run's
 * snapshot from the persisted cache" half of the design. Used for the
 * zip-form path, where the archive's own on-disk `.cache/` entries (if any)
 * are stale the moment a run has written a persisted cache elsewhere (the
 * host never rewrites the user's zip — see `docs` design comment).
 */
export function withPersistedCache(
  base: Record<string, Uint8Array>,
  persisted: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  return { ...base, ...persisted };
}

/** Bare, lowercased hostnames a manifest declares under `permissions.net.get`/`.post`, deduplicated. */
export function manifestNetHosts(manifest: BundleManifest): string[] {
  const get = manifest.permissions?.net?.get ?? [];
  const post = manifest.permissions?.net?.post ?? [];
  return [...new Set([...get, ...post].map((host) => host.toLowerCase()))];
}

/**
 * Consent unification (SECURITY-RELEVANT, GitHub issue #9 follow-up): a
 * bundle's manifest `permissions.net` is DECLARED INTENT only. The static
 * scan of the run's executable closure (`./script-requirements.ts`) is the
 * ONLY source of the hostnames a run prompts for, for a bundle exactly as
 * for a bare `.mk.md` document — the manifest's declaration never widens
 * that prompt (a declared-but-unused host is never prompted for) and never
 * narrows it (a host a script actually reaches is always prompted for,
 * declared or not).
 *
 * A mismatch between the two is not silently absorbed: this pure function
 * returns one diagnostics line per mismatched host, in both directions, for
 * the host's diagnostics surface (docs/integration.md) — never the rendered
 * page. Wording lives here, the one place both apps' adapters read it from,
 * so it can never drift between VS Code's output channel and Obsidian's
 * console/notice surface.
 *
 * Returns `[]` when the two sets agree (including when both are empty).
 * Order: every declared-but-unused host first (in `declaredHosts` order),
 * then every used-but-undeclared host (in `scannedHosts` order) — matching
 * how `manifestNetHosts`/`extractRunRequirements` already dedupe and order
 * their inputs, so this function does no case-folding or deduping of its
 * own.
 */
export function netDeclarationDiagnostics(
  declaredHosts: readonly string[],
  scannedHosts: readonly string[],
): string[] {
  const declared = new Set(declaredHosts);
  const scanned = new Set(scannedHosts);
  const lines: string[] = [];
  for (const host of declaredHosts) {
    if (!scanned.has(host)) {
      lines.push(
        `The manifest declares net access to ${host}. No script in this run uses that host.`,
      );
    }
  }
  for (const host of scannedHosts) {
    if (!declared.has(host)) {
      lines.push(
        `A script in this run uses net access to ${host}. The manifest does not declare that host.`,
      );
    }
  }
  return lines;
}

/** The bundle-filesystem grants a manifest declares under `permissions.bundle` (`'read'` / `'write:.cache/'`), or `[]` when it declares none. */
export function manifestBundleFsGrants(
  manifest: BundleManifest,
): BundleFsGrant[] {
  return manifest.permissions?.bundle ?? [];
}

/**
 * Cap on a zip-form bundle's persisted `.cache/` state (extension storage,
 * keyed by bundle identity — see `preview-panel.ts`'s adapters). Mirrors
 * `run-flow.ts`'s `MAX_CACHE_SNAPSHOT_BYTES` for the unrelated `cache.get`
 * Memento snapshot: real script-written cache files are small, so this
 * exists purely to guarantee a runaway/adversarial bundle can never grow
 * `workspaceState` without bound. Oversize state is DROPPED wholesale, not
 * partially persisted — see that constant's doc comment for why a partial
 * write is worse than none.
 */
export const MAX_PERSISTED_BUNDLE_CACHE_BYTES = 1_000_000;

/** A JSON-safe, base64-encoded form of a `path -> bytes` cache map, suitable for a `vscode.Memento` value. */
export type EncodedBundleCache = Record<string, string>;

/**
 * Encodes `files` (a bundle run's `.cache/` output) for Memento storage, or
 * `undefined` when it must be dropped instead — either it doesn't encode at
 * all, or the encoded form exceeds `MAX_PERSISTED_BUNDLE_CACHE_BYTES`.
 * Callers write `undefined` back to storage in that case, exactly like
 * `run-flow.ts`'s `serializeCacheSnapshotIfSmallEnough`.
 */
export function encodeBundleCacheForStorage(
  files: Record<string, Uint8Array>,
): EncodedBundleCache | undefined {
  const encoded: EncodedBundleCache = {};
  let total = 0;
  for (const [path, bytes] of Object.entries(files)) {
    total += bytes.length;
    if (total > MAX_PERSISTED_BUNDLE_CACHE_BYTES) return undefined;
    encoded[path] = Buffer.from(bytes).toString('base64');
  }
  return encoded;
}

/**
 * Decodes a value read back from a `vscode.Memento` into a `path -> bytes`
 * cache map — never trusts the stored shape further than "every value is a
 * string that decodes as base64"; a corrupt/foreign/hand-edited value
 * degrades to an empty map (no persisted cache), matching this whole
 * module's fail-safe posture (`grant-flow.ts`'s `isStoredGrant` takes the
 * same stance for its own Memento reads).
 */
export function decodeBundleCacheFromStorage(
  value: unknown,
): Record<string, Uint8Array> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, Uint8Array> = {};
  for (const [path, encoded] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof encoded !== 'string') continue;
    try {
      out[path] = new Uint8Array(Buffer.from(encoded, 'base64'));
    } catch {
      // Skip a value that isn't valid base64 rather than failing the whole
      // decode — one corrupt entry shouldn't take down every other cached
      // file.
    }
  }
  return out;
}
