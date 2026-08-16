import { inflateSync, strFromU8, zipSync } from 'fflate';
import { BundleZipError } from './errors.js';
import { normalizeBundlePath } from './paths.js';
import type { BundleStorage } from './storage.js';
import { normalizeOrThrow } from './storage.js';

/**
 * Wraps an in-memory `Map<normalized path, bytes>` as a `BundleStorage`.
 * Shared by `openZipBundle` and (via `dirToZip`/`zipToDir` in `./fs`) the
 * directory <-> zip conversions, so both round trips exercise the exact
 * same read/write/list/exists semantics as a "real" zip bundle.
 *
 * A `Map` (not a plain object) is used deliberately: `Map` keys are opaque
 * key/value pairs with no magic property names, so a bundle path literally
 * equal to `__proto__` is just an ordinary key here — see the "prototype
 * pollution" note on `openZipBundle` below for why that distinction matters.
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

// ---------------------------------------------------------------------------
// Minimal, hand-rolled ZIP central-directory reader.
//
// Why not just call fflate's `unzipSync`? Three reasons, all defects fixed
// in this module:
//
//  1. No decompression size guard (DEFECT 4): `unzipSync` allocates the
//     *declared* uncompressed size for every entry before/while inflating,
//     with no cap — a small, highly-compressible archive can claim an
//     enormous uncompressed size and OOM the process just by being opened.
//     Reading a bundle must always be safe (spec §10).
//  2. No CRC-32 verification (DEFECT 6): `unzipSync` never exposes or checks
//     the CRC-32 each entry's header carries, so silent bit-flip corruption
//     produces silently-wrong data instead of a loud error.
//  3. Prototype pollution (DEFECT 7): fflate's own `unzipSync` accumulates
//     results into a plain `{}` via `results[entryName] = data`. An entry
//     literally named `__proto__` doesn't become an own property on that
//     object — it reassigns the object's prototype instead (verified
//     empirically against fflate 0.8.3: it actually throws a TypeError
//     from deep inside `zipSync`/`unzipSync`'s internals for a *top-level*
//     `__proto__` entry). We can't fix fflate's internals, so we don't
//     route through them for the read side at all: this reader walks the
//     ZIP central directory ourselves and accumulates into a `Map`, which
//     has no magic key names, so `__proto__`/`constructor`/`prototype`
//     entries are handled exactly like any other name — no special-casing
//     needed on open.
//
// This intentionally does NOT support ZIP64 (archives >4GB or >65535
// entries) — out of scope for a personal note-bundle format, and a
// half-correct ZIP64 implementation is worse than a loud rejection. Central
// directory entries are the source of truth for size/CRC (not local file
// header data descriptors), matching the ZIP spec's guidance that the
// central directory is authoritative.
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

/** Reads a little-endian uint16 at byte offset `b`. */
function readU16(d: Uint8Array, b: number): number {
  return (d[b] ?? 0) | ((d[b + 1] ?? 0) << 8);
}

/** Reads a little-endian uint32 at byte offset `b`. */
function readU32(d: Uint8Array, b: number): number {
  return (
    ((d[b] ?? 0) |
      ((d[b + 1] ?? 0) << 8) |
      ((d[b + 2] ?? 0) << 16) |
      ((d[b + 3] ?? 0) << 24)) >>>
    0
  );
}

interface RawZipEntry {
  /** The literal entry name as stored in the archive — not yet normalized. */
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
}

/** Locates the end-of-central-directory record; mirrors fflate's own scan. */
function findEocd(data: Uint8Array): number {
  for (let e = data.length - 22; e >= 0; e--) {
    if (readU32(data, e) === EOCD_SIGNATURE) return e;
    if (data.length - e > 65558) break;
  }
  throw new BundleZipError(
    'zip bundle rejected: not a valid zip archive (no end-of-central-directory record found)',
    [],
  );
}

/** Walks the central directory, returning one `RawZipEntry` per record. */
function readCentralDirectory(data: Uint8Array): RawZipEntry[] {
  const eocd = findEocd(data);
  const count = readU16(data, eocd + 8);
  const cdOffset = readU32(data, eocd + 16);

  if (count === 0xffff || cdOffset === ZIP64_SENTINEL) {
    throw new BundleZipError(
      'zip bundle rejected: ZIP64 archives are not supported',
      [],
    );
  }

  const entries: RawZipEntry[] = [];
  let o = cdOffset;
  for (let i = 0; i < count; i++) {
    if (o + 46 > data.length || readU32(data, o) !== CENTRAL_DIR_SIGNATURE) {
      throw new BundleZipError(
        'zip bundle rejected: malformed central directory record',
        [],
      );
    }
    const generalFlag = readU16(data, o + 8);
    const compression = readU16(data, o + 10);
    const crc32Field = readU32(data, o + 16);
    const compressedSize = readU32(data, o + 20);
    const uncompressedSize = readU32(data, o + 24);
    const nameLen = readU16(data, o + 28);
    const extraLen = readU16(data, o + 30);
    const commentLen = readU16(data, o + 32);
    const localHeaderOffset = readU32(data, o + 42);

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw new BundleZipError(
        'zip bundle rejected: ZIP64 archives are not supported',
        [],
      );
    }

    const nameStart = o + 46;
    if (nameStart + nameLen > data.length) {
      throw new BundleZipError(
        'zip bundle rejected: malformed central directory record (truncated file name)',
        [],
      );
    }
    // Bit 11 (0x0800) of the general-purpose flag marks a UTF-8 name;
    // otherwise fall back to the legacy (effectively latin1/CP437-ish)
    // interpretation — matches fflate's own `zh()` decoding rule.
    const isUtf8 = (generalFlag & 0x0800) !== 0;
    const name = strFromU8(
      data.subarray(nameStart, nameStart + nameLen),
      !isUtf8,
    );

    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      crc32: crc32Field,
      localHeaderOffset,
    });

    o = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Given a central-directory entry's local header offset, returns the byte offset where its (compressed) data begins. */
function localDataOffset(data: Uint8Array, localHeaderOffset: number): number {
  if (
    localHeaderOffset + 30 > data.length ||
    readU32(data, localHeaderOffset) !== LOCAL_HEADER_SIGNATURE
  ) {
    throw new BundleZipError(
      'zip bundle rejected: malformed local file header',
      [],
    );
  }
  const nameLen = readU16(data, localHeaderOffset + 26);
  const extraLen = readU16(data, localHeaderOffset + 28);
  return localHeaderOffset + 30 + nameLen + extraLen;
}

// ---- CRC-32 (ISO 3309 / ITU-T V.42, the zip/gzip/PNG polynomial) ---------
// fflate does not export a CRC-32 utility (its own is an internal, private
// closure used only when *writing* zips), so this is a small, standard,
// self-contained implementation — not a new dependency, just ~15 lines of
// well-known table-driven CRC-32, computed over bytes we already have.
let crc32Table: Uint32Array | undefined;
function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crc32Table = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Options for `openZipBundle`'s decompression-bomb guard (DEFECT 4). */
export interface OpenZipBundleOptions {
  /**
   * Reject an entry whose *declared* (header) uncompressed size exceeds
   * this many bytes, before ever allocating a decompression buffer for it.
   * Defaults to `DEFAULT_MAX_ZIP_ENTRY_BYTES`.
   */
  maxEntryBytes?: number;
  /**
   * Reject the archive once the running sum of every processed entry's
   * declared uncompressed size exceeds this many bytes. Defaults to
   * `DEFAULT_MAX_ZIP_TOTAL_BYTES`.
   */
  maxTotalBytes?: number;
}

/** Default per-entry decompressed-size cap: 256MB. */
export const DEFAULT_MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
/** Default total (summed across all entries) decompressed-size cap: 256MB. */
export const DEFAULT_MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;

/**
 * Opens the zip form of a bundle (browser-safe: `fflate` has no Node
 * dependency; the ZIP container parsing here is our own and is also
 * dependency-free). Directory entries (names ending in `/`) carry no data
 * and are skipped — but only *after* the name has passed
 * `normalizeBundlePath` (DEFECT 8: validating before the directory-entry
 * skip means a malformed directory entry like `../evil/` is rejected loudly,
 * the same as its non-directory counterpart `../evil`, instead of being
 * silently dropped).
 *
 * Zip-slip protection: every file entry's name is run through
 * `normalizeBundlePath`. Any entry that fails (`../`, an absolute path, a
 * backslash path, a drive-letter path) is collected and, if any exist,
 * the whole open is rejected with a `BundleZipError` listing every
 * offending name — a tampered bundle must be loud, not silently pruned
 * down to "the entries that happened to be safe."
 *
 * Collision protection (DEFECT 5): two distinct raw entry names that
 * *normalize* to the same bundle path (e.g. `manifest.json` and
 * `./manifest.json`, or `cache/x` and `cache//x`) are rejected outright
 * rather than silently last-wins — a bundle could otherwise show a benign
 * file to one reader and a hostile one to another depending on which
 * implementation's normalization/iteration order "wins".
 *
 * Decompression-bomb protection (DEFECT 4): every entry's declared
 * uncompressed size (read from the central directory, before any inflation
 * happens) is checked against `options.maxEntryBytes`, and the running
 * total across all entries against `options.maxTotalBytes`. A crafted
 * high-ratio archive is rejected before its claimed size is ever allocated.
 *
 * CRC-32 verification (DEFECT 6): every entry's decompressed bytes are
 * checked against the CRC-32 recorded in the central directory; a mismatch
 * (corrupt archive, flipped bit) throws `BundleZipError` instead of
 * silently returning wrong data.
 */
export function openZipBundle(
  bytes: Uint8Array,
  options: OpenZipBundleOptions = {},
): BundleStorage {
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ZIP_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_ZIP_TOTAL_BYTES;

  const rawEntries = readCentralDirectory(bytes);

  const offending: string[] = [];
  const collisionEntries: string[] = []; // raw names involved in a collision
  const collisionMessages: string[] = [];
  const seenBy = new Map<string, string>(); // normalized path -> first raw name that claimed it
  const validFileEntries: { raw: RawZipEntry; normalizedPath: string }[] = [];

  for (const entry of rawEntries) {
    const normalized = normalizeBundlePath(entry.name);
    if (!normalized.ok) {
      offending.push(entry.name);
      continue;
    }
    if (entry.name.endsWith('/')) continue; // well-formed directory entry: no data, skip

    const prior = seenBy.get(normalized.path);
    if (prior !== undefined) {
      collisionEntries.push(prior, entry.name);
      collisionMessages.push(
        `${JSON.stringify(prior)} and ${JSON.stringify(entry.name)} both normalize to ${JSON.stringify(normalized.path)}`,
      );
      continue;
    }
    seenBy.set(normalized.path, entry.name);
    validFileEntries.push({ raw: entry, normalizedPath: normalized.path });
  }

  if (offending.length > 0) {
    throw new BundleZipError(
      `zip bundle rejected: ${offending.length} ${offending.length === 1 ? 'entry has' : 'entries have'} an unsafe path: ${offending.join(', ')}`,
      offending,
    );
  }
  if (collisionEntries.length > 0) {
    throw new BundleZipError(
      `zip bundle rejected: colliding entry names normalize to the same bundle path: ${collisionMessages.join('; ')}`,
      collisionEntries,
    );
  }

  const map = new Map<string, Uint8Array>();
  let totalUncompressed = 0;

  for (const { raw: entry, normalizedPath } of validFileEntries) {
    if (entry.uncompressedSize > maxEntryBytes) {
      throw new BundleZipError(
        `zip bundle rejected: entry ${JSON.stringify(entry.name)} declares ${entry.uncompressedSize} uncompressed bytes, exceeding the ${maxEntryBytes}-byte per-entry limit`,
        [entry.name],
      );
    }
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > maxTotalBytes) {
      throw new BundleZipError(
        `zip bundle rejected: total declared uncompressed size exceeds the ${maxTotalBytes}-byte budget`,
        [entry.name],
      );
    }

    const dataStart = localDataOffset(bytes, entry.localHeaderOffset);
    const compressed = bytes.subarray(
      dataStart,
      dataStart + entry.compressedSize,
    );

    let data: Uint8Array;
    if (entry.compression === 0) {
      data = compressed.slice();
    } else if (entry.compression === 8) {
      try {
        data = inflateSync(compressed, {
          out: new Uint8Array(entry.uncompressedSize),
        });
      } catch (err) {
        throw new BundleZipError(
          `zip bundle rejected: entry ${JSON.stringify(entry.name)} failed to decompress (corrupt data): ${err instanceof Error ? err.message : String(err)}`,
          [entry.name],
        );
      }
    } else {
      throw new BundleZipError(
        `zip bundle rejected: entry ${JSON.stringify(entry.name)} uses unsupported compression method ${entry.compression}`,
        [entry.name],
      );
    }

    const actualCrc = crc32(data);
    if (actualCrc !== entry.crc32) {
      throw new BundleZipError(
        `zip bundle rejected: entry ${JSON.stringify(entry.name)} failed CRC-32 verification (corrupt data)`,
        [entry.name],
      );
    }

    map.set(normalizedPath, data);
  }

  return createMapStorage(map);
}

/**
 * Serializes a `BundleStorage` to zip bytes. Zip metadata (unix
 * permission/symlink bits) is never written — `fflate`'s `zipSync` writes
 * plain file entries, so re-extracting a bundle produced here can never
 * materialize a symlink.
 *
 * The accumulator is an `Object.create(null)` dict (DEFECT 7), not a plain
 * `{}` — `fflate`'s `zipSync` flattens its input with a bracket-assignment
 * loop (`t[key] = ...`) that inherits the same `__proto__` special-case
 * problem when `key` is nested under a directory prefix; giving it a
 * null-prototype object here means a bundle path like `cache/__proto__`
 * (a *nested* `__proto__`, i.e. everything except a bare top-level path)
 * round-trips correctly instead of silently corrupting our own dict.
 *
 * A bundle path that is *exactly* `__proto__` (or `constructor` /
 * `prototype`) at the top level — no directory prefix — cannot be
 * represented at all: this is a hard limitation inside `fflate` 0.8.3
 * itself (its internal flattening step, `fltn`, does `t[name] = [...]` on
 * its *own* plain `{}` accumulator, which we cannot reach or fix), verified
 * empirically to throw a raw `TypeError` from deep inside `zipSync` rather
 * than silently corrupting. We turn that into a clear, typed
 * `BundleZipError` instead of letting the raw `TypeError` escape.
 */
export async function exportZipBundle(
  storage: BundleStorage,
): Promise<Uint8Array> {
  const paths = await storage.list();
  const topLevelProtoLike = paths.filter(
    (p) => p === '__proto__' || p === 'constructor' || p === 'prototype',
  );
  if (topLevelProtoLike.length > 0) {
    throw new BundleZipError(
      `zip export rejected: bundle path(s) ${topLevelProtoLike.map((p) => JSON.stringify(p)).join(', ')} cannot be represented as a top-level zip entry ` +
        `(fflate's zip writer cannot serialize a top-level entry literally named "__proto__", "constructor", or "prototype"); ` +
        `nest the file under a directory (e.g. "cache/__proto__") to work around this`,
      topLevelProtoLike,
    );
  }

  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  for (const path of paths) {
    const data = await storage.read(path);
    if (data !== undefined) files[path] = data;
  }
  return zipSync(files);
}
