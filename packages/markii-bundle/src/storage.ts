import { BundlePathError } from './errors.js';
import { normalizeBundlePath } from './paths.js';

const utf8Encoder = new TextEncoder();

/**
 * Common shape both bundle forms (zip, directory) implement. Every method
 * takes/returns bundle-relative paths and routes through
 * `normalizeBundlePath` before touching storage — see `normalizeOrThrow`.
 *
 * IMPORTANT for implementers: every method MUST route its `path` argument
 * through `normalizeOrThrow` (or an equivalent check) before touching disk
 * or an in-memory archive. `ScriptView` (`./script-view`) delegates *all*
 * path validation to whatever `BundleStorage` it's given — it does not
 * re-normalize paths itself. A storage implementation that skips this
 * choke point unjails every `ScriptView` built on top of it, no matter how
 * carefully `isWriteAllowed`/`normalizeBundlePath` are enforced elsewhere.
 * The directory form (`./fs`) additionally must not follow symlinks or
 * hard links when resolving a path to a physical file — see
 * `resolveInsideRoot` and `writeExistingFileNoHardlink` there for why a
 * *logical* path-jail alone is not sufficient once real files are involved.
 */
export interface BundleStorage {
  /** Returns the file's bytes, or `undefined` if no such path exists. */
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** All file paths currently in the bundle, bundle-relative, sorted. */
  list(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  /**
   * Returns the file's byte length, or `undefined` if no such path exists —
   * WITHOUT reading (let alone inflating) its contents. This is what lets a
   * caller (e.g. `buildBundleSnapshot` in `apps/vscode`) enforce a size
   * budget by skipping an over-budget file before it is ever materialized in
   * memory, rather than reading it whole and only then discovering it was too
   * big. Must route through the exact same path-jail/symlink-refusal a
   * `read` of the same path would (see the class doc comment above) — a
   * caller must never be able to learn the size of, or prove the existence
   * of, a path `read`/`write` would refuse.
   */
  size(path: string): Promise<number | undefined>;
}

/**
 * The shared choke point every `BundleStorage` implementation calls before
 * touching an archive or the filesystem: normalizes `path` or throws a
 * `BundlePathError` describing why it was rejected.
 */
export function normalizeOrThrow(path: string): string {
  const result = normalizeBundlePath(path);
  if (!result.ok) {
    throw new BundlePathError(path, result.reason);
  }
  return result.path;
}

/**
 * A third `BundleStorage` form, alongside the zip form (`./zip`) and the
 * Node-only directory form (`./fs`): a plain in-memory bundle, backed by
 * nothing more than a `Map`. No zip bytes to parse, no real filesystem to
 * guard against symlinks or hard links — this form exists for a host that
 * already has a bundle's files as plain values (a browser tab building a
 * bundle from scratch, a test harness) and wants the same `BundleStorage`
 * contract without a Node dependency, so it lives on the browser-safe main
 * entry (`./index`) rather than the `./fs` subpath.
 *
 * `files` maps a bundle-relative path to its content, either already as
 * bytes or as a string encoded here as UTF-8 — the same encoding every
 * other `BundleStorage` form uses for text. Every key is routed through the
 * exact same `normalizeOrThrow` choke point every other form uses (never a
 * reimplemented jail): an individually invalid path throws `BundlePathError`
 * immediately, and two distinct keys that normalize to the same path (e.g.
 * `"note.mk.md"` and `"./note.mk.md"`) are rejected the same way `openZipBundle`
 * rejects colliding zip entries, rather than silently letting one shadow the
 * other.
 *
 * Like the zip and directory forms, this storage enforces only the
 * structural path-jail — never `isWriteAllowed`. Confining writes to
 * `.cache/` is `ScriptView`'s job (`./script-view`), which wraps whatever
 * `BundleStorage` it is given; a caller wanting that policy applied wraps
 * this storage in `createScriptView` exactly as it would the zip or
 * directory form.
 */
export function createMemoryBundleStorage(
  files: Readonly<Record<string, string | Uint8Array>> = {},
): BundleStorage {
  const map = new Map<string, Uint8Array>();

  for (const [rawPath, content] of Object.entries(files)) {
    const normalized = normalizeOrThrow(rawPath);
    if (map.has(normalized)) {
      throw new BundlePathError(
        rawPath,
        `collides with another entry after normalization (both resolve to ${JSON.stringify(normalized)})`,
      );
    }
    map.set(
      normalized,
      typeof content === 'string' ? utf8Encoder.encode(content) : content,
    );
  }

  return {
    read(path) {
      return Promise.resolve(map.get(normalizeOrThrow(path)));
    },
    write(path, data) {
      map.set(normalizeOrThrow(path), data);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve(Array.from(map.keys()).sort());
    },
    exists(path) {
      return Promise.resolve(map.has(normalizeOrThrow(path)));
    },
    size(path) {
      const data = map.get(normalizeOrThrow(path));
      return Promise.resolve(data === undefined ? undefined : data.length);
    },
  };
}
