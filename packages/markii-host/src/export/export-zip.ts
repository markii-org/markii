/**
 * Packing a cascade export into one archive (GitHub issue #28 slice 3,
 * part 2).
 *
 * WHY NOT `@markii/bundle`. That package's zip module is about `.mkz`
 * bundles: reading one safely (entry-size guards, CRC checks, a path jail)
 * and writing one back out with a manifest. A cascade archive is not a
 * bundle. It has no manifest, no scripts, and no bundle semantics at all,
 * so borrowing `exportZipBundle` would mean claiming a format this is not.
 * What both share is `fflate`, an approved dependency, so this writes the
 * archive directly and stays a dozen lines.
 *
 * Host-neutral and free of `node:*`: `fflate` and `TextEncoder` work in
 * every environment either host runs in.
 */
import { zipSync } from 'fflate';

/** One file in a cascade archive. */
export interface ExportArchiveEntry {
  /** The file's name inside the archive. Flat: no directories. */
  readonly name: string;
  /** The file's UTF-8 text. */
  readonly text: string;
}

/**
 * The archive bytes for `entries`.
 *
 * Deflate level 6, the ordinary default: exported HTML embeds base64 image
 * data, which compresses poorly, while the markup around it compresses
 * well, and level 6 is the balance every archiver picked for the same
 * reason.
 *
 * `mtime` is deliberately not set, so the same set of notes always produces
 * byte-identical output and a re-export is diffable.
 */
export function zipExportArchive(
  entries: readonly ExportArchiveEntry[],
): Uint8Array {
  const encoder = new TextEncoder();
  // A null-prototype object, matching how `@markii/bundle`'s own zip
  // writing guards `zipSync`'s bracket assignment against a file named
  // `__proto__`.
  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  for (const entry of entries) {
    files[entry.name] = encoder.encode(entry.text);
  }
  return zipSync(files, { level: 6 });
}
