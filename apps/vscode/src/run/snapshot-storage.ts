/**
 * A `@markii/bundle` `BundleStorage` backed by a plain in-memory snapshot
 * (a `path -> bytes` record) — never a live zip handle or a disk path. This
 * is what the worker (`./worker-entry.ts`) hands to `@markii/bundle`'s
 * `createScriptView`, so a run's `bundle.read`/`write`/`exists` calls never
 * touch anything outside the bytes the host chose to include in the
 * snapshot (`./bundle-run.ts`'s `buildBundleSnapshot`).
 *
 * `write` is reachable only through `ScriptView` (`@markii/bundle`), which
 * already gates every write with `isWriteAllowed` before ever calling
 * here — this storage does not re-derive that policy, matching
 * `./storage.ts`'s own division of labor (`ScriptView` decides WHETHER a
 * path may be written; a `BundleStorage` only knows HOW). What this module
 * DOES enforce, unconditionally, is the same path-jail every
 * `BundleStorage` implementation must (`@markii/bundle`'s own doc comment
 * on `BundleStorage`): every path is normalized via `normalizeBundlePath`
 * before it ever touches the underlying `Map`.
 */
import type { BundleStorage } from '@markii/bundle';
import { BundlePathError, normalizeBundlePath } from '@markii/bundle';

function normalizeOrThrow(path: string): string {
  const result = normalizeBundlePath(path);
  if (!result.ok) {
    throw new BundlePathError(path, result.reason);
  }
  return result.path;
}

export interface SnapshotStorage extends BundleStorage {
  /** The storage's current contents, after any writes a run performed — used by the host to extract `.cache/` output once a run finishes. */
  currentFiles(): Record<string, Uint8Array>;
}

/** Builds a `BundleStorage` over `initialFiles`, copying it so the caller's own object is never mutated by a later write. */
export function createSnapshotStorage(
  initialFiles: Record<string, Uint8Array>,
): SnapshotStorage {
  const map = new Map<string, Uint8Array>(Object.entries(initialFiles));

  return {
    async read(path) {
      return map.get(normalizeOrThrow(path));
    },
    async write(path, data) {
      map.set(normalizeOrThrow(path), data);
    },
    async list() {
      return [...map.keys()].sort();
    },
    async exists(path) {
      return map.has(normalizeOrThrow(path));
    },
    currentFiles: () => Object.fromEntries(map),
  };
}
