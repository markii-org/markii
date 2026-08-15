import { unzipSync, zipSync } from 'fflate';
import { BundleZipError } from './errors';
import { normalizeBundlePath } from './paths';
import type { BundleStorage } from './storage';
import { normalizeOrThrow } from './storage';

/**
 * Wraps an in-memory `Map<normalized path, bytes>` as a `BundleStorage`.
 * Shared by `openZipBundle` and (via `dirToZip`/`zipToDir` in `./fs`) the
 * directory <-> zip conversions, so both round trips exercise the exact
 * same read/write/list/exists semantics as a "real" zip bundle.
 */
function createMapStorage(map: Map<string, Uint8Array>): BundleStorage {
  return {
    read(path) {
      const normalized = normalizeOrThrow(path);
      return Promise.resolve(map.get(normalized));
    },
    write(path, data) {
      const normalized = normalizeOrThrow(path);
      map.set(normalized, data);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve(Array.from(map.keys()).sort());
    },
    exists(path) {
      const normalized = normalizeOrThrow(path);
      return Promise.resolve(map.has(normalized));
    },
  };
}

/**
 * Opens the zip form of a bundle (browser-safe: `fflate` has no Node
 * dependency). Directory entries (names ending in `/`) are skipped — they
 * carry no data and this storage has no notion of empty directories.
 *
 * Zip-slip protection: every file entry's name is run through
 * `normalizeBundlePath`. Any entry that fails (`../`, an absolute path, a
 * backslash path, a drive-letter path) is collected and, if any exist,
 * the whole open is rejected with a `BundleZipError` listing every
 * offending name — a tampered bundle must be loud, not silently pruned
 * down to "the entries that happened to be safe."
 */
export function openZipBundle(bytes: Uint8Array): BundleStorage {
  const unzipped = unzipSync(bytes);
  const map = new Map<string, Uint8Array>();
  const offending: string[] = [];

  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('/')) continue; // directory entry: no data, skip

    const normalized = normalizeBundlePath(name);
    if (!normalized.ok) {
      offending.push(name);
      continue;
    }
    map.set(normalized.path, data);
  }

  if (offending.length > 0) {
    throw new BundleZipError(
      `zip bundle rejected: ${offending.length} ${offending.length === 1 ? 'entry has' : 'entries have'} an unsafe path: ${offending.join(', ')}`,
      offending,
    );
  }

  return createMapStorage(map);
}

/**
 * Serializes a `BundleStorage` to zip bytes. Zip metadata (unix
 * permission/symlink bits) is never written — `fflate`'s `zipSync` writes
 * plain file entries, so re-extracting a bundle produced here can never
 * materialize a symlink.
 */
export async function exportZipBundle(
  storage: BundleStorage,
): Promise<Uint8Array> {
  const paths = await storage.list();
  const files: Record<string, Uint8Array> = {};
  for (const path of paths) {
    const data = await storage.read(path);
    if (data !== undefined) files[path] = data;
  }
  return zipSync(files);
}
