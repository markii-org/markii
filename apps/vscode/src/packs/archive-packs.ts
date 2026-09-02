/**
 * `.mkp` pack archive handling for "Markii: Install Pack from File…"
 * (docs/packs.md). A `markii.packs` entry now only ever names a folder
 * (source or prebuilt); an archive reaches this extension only through the
 * install command, never as a configured pack-list entry. This module is
 * what `./install-pack.ts` shares with a folder-shaped pack: reading
 * `@markii/pack`'s validated archive contents (`describeArchiveError`) and
 * writing them out as a plain pack directory (`writeArchiveContents`),
 * behind the same filesystem-write seam (`ArchiveExtractFs`) so the module
 * stays testable without touching real disk.
 */
import * as path from 'node:path';
import {
  mkdir as nodeMkdir,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import type { PackArchiveContents, PackArchiveError } from '@markii/pack';

/** The filesystem write seam `writeArchiveContents` needs. Deliberately narrow: extracting an archive only ever creates files under a directory it first clears, it never reads back or deletes anything else. */
export interface ArchiveExtractFs {
  /** Removes `absolutePath` and everything under it, or resolves quietly if it does not exist. Never rejects: a directory that fails to clear is treated the same as a fresh one, and the write that follows will simply fail on its own if the path is genuinely unusable. */
  readonly removeDirectory: (absolutePath: string) => Promise<void>;
  /** Creates a directory and any missing parents. May reject on a genuine I/O failure. */
  readonly makeDirectory: (absolutePath: string) => Promise<void>;
  readonly writeFile: (
    absolutePath: string,
    bytes: Uint8Array,
  ) => Promise<void>;
}

/** The real, Node-backed `ArchiveExtractFs`. */
export function createNodeArchiveExtractFs(): ArchiveExtractFs {
  return {
    removeDirectory: async (absolutePath) => {
      try {
        await nodeRm(absolutePath, { recursive: true, force: true });
      } catch {
        // Quiet: the write that follows fails loudly on its own if the
        // path is genuinely unusable.
      }
    },
    makeDirectory: async (absolutePath) => {
      await nodeMkdir(absolutePath, { recursive: true });
    },
    writeFile: async (absolutePath, bytes) => {
      await nodeWriteFile(absolutePath, bytes);
    },
  };
}

/** One line describing why `openPackArchive` rejected an archive, for a host's skipped-folder / diagnostics wording. Passes `kind: 'zip'`'s message through verbatim (already specific: a path-escaping entry, an oversized entry, a corrupt zip); summarizes the other two kinds plainly. */
export function describeArchiveError(error: PackArchiveError): string {
  if (error.kind === 'zip') return error.message;
  if (error.kind === 'missing-entry') return error.message;
  return `invalid pack.json in archive (${error.errors.join('; ')})`;
}

/**
 * Writes a validated archive's contents into `destinationDir`: `pack.json`
 * (the parsed manifest, re-serialized: `openPackArchive` keeps only the
 * validated manifest fields, not the original bytes, so the written file
 * is a normalized round-trip of the same fields, not a byte-for-byte
 * copy), `webview.js`, `webview.css` when the archive has one, and
 * `scripts/*` when it ships any. Does NOT clear `destinationDir` first;
 * callers that need a clean re-extract (a reinstall) call
 * `fs.removeDirectory` themselves before this, so a caller with a reason to
 * layer writes (none today) is free to.
 */
export async function writeArchiveContents(
  archive: PackArchiveContents,
  destinationDir: string,
  fs: ArchiveExtractFs,
): Promise<void> {
  await fs.makeDirectory(destinationDir);
  const encoder = new TextEncoder();
  await fs.writeFile(
    path.join(destinationDir, 'pack.json'),
    encoder.encode(JSON.stringify(archive.manifest, null, 2) + '\n'),
  );
  await fs.writeFile(
    path.join(destinationDir, 'webview.js'),
    archive.scriptBytes,
  );
  if (archive.stylesheetBytes !== undefined) {
    await fs.writeFile(
      path.join(destinationDir, 'webview.css'),
      archive.stylesheetBytes,
    );
  }
  const moduleNames = Object.keys(archive.scriptModules);
  if (moduleNames.length > 0) {
    const scriptsDir = path.join(destinationDir, 'scripts');
    for (const name of moduleNames) {
      const target = path.join(scriptsDir, name);
      await fs.makeDirectory(path.dirname(target));
      await fs.writeFile(target, archive.scriptModules[name]!);
    }
  }
}
