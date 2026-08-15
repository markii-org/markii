import { BundlePathError } from './errors';
import { normalizeBundlePath } from './paths';

/**
 * Common shape both bundle forms (zip, directory) implement. Every method
 * takes/returns bundle-relative paths and routes through
 * `normalizeBundlePath` before touching storage — see `normalizeOrThrow`.
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
