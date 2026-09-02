/**
 * `.mkp` pack archive handling for "Install Markii pack from file"
 * (`./install-pack.ts`) — the ONLY way a pack archive enters this plugin
 * (AGENTS.md's Host positioning: Obsidian is archive-only, no compiler, no
 * user-managed pack-folder list). This module bridges `@markii/pack`'s
 * in-memory archive reader (`openPackArchive`, already built and never
 * modified here) into the write this plugin's install command needs:
 * extracting a validated archive's contents onto disk, under
 * `../main.ts`'s `installedPacksDir()`.
 *
 * `obsidian`-free: plain paths and bytes in, `@markii/pack` types out, so
 * this stays unit-testable without a real vault.
 */
import * as path from 'node:path';
import {
  mkdir as nodeMkdir,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import type { PackArchiveContents, PackArchiveError } from '@markii/pack';

/** One line describing why `openPackArchive` rejected an archive, for this plugin's diagnostics wording. Passes `kind: 'zip'`'s and `kind: 'missing-entry'`'s message through verbatim (already specific); summarizes a manifest failure plainly. */
export function describeArchiveError(error: PackArchiveError): string {
  if (error.kind === 'zip') return error.message;
  if (error.kind === 'missing-entry') return error.message;
  return `invalid pack.json in archive (${error.errors.join('; ')})`;
}

/** The filesystem write seam `writeArchiveContents` needs (`./install-pack.ts`). Deliberately narrow: extracting an archive only ever creates files under a directory it first clears, it never reads back or deletes anything else. */
export interface ArchiveExtractFs {
  /** Removes `absolutePath` and everything under it, or resolves quietly if it does not exist. Never rejects — a directory that fails to clear is treated the same as a fresh one, and the write that follows fails loudly on its own if the path is genuinely unusable. */
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

/**
 * Writes a validated archive's contents into `destinationDir`: `pack.json`
 * (the parsed manifest, re-serialized — `openPackArchive` keeps only the
 * validated manifest fields, not the original bytes, so the written file is
 * a normalized round-trip of the same fields, not a byte-for-byte copy),
 * `webview.js`, `webview.css` when the archive has one, and `scripts/*`
 * when it ships any. Does NOT clear `destinationDir` first — a caller that
 * needs a clean re-extract (a reinstall replacing an existing pack) calls
 * `fs.removeDirectory` itself before this.
 *
 * PATH JAIL: `@markii/pack`'s `openPackArchive` has already rejected any
 * entry whose name escapes the archive (`../`, an absolute path) or
 * exceeds its size caps before this function ever sees `archive` — every
 * path it writes here is built from `destinationDir` joined with a plain,
 * already-validated relative name (`pack.json`, `webview.js`,
 * `webview.css`, or a `scripts/`-relative Lua module name), never from
 * anything read back out of the zip's raw entry names.
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
