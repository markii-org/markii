import { BundlePathError } from './errors';
import { normalizeBundlePath } from './paths';

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
