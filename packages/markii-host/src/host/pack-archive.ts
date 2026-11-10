/**
 * `.mkp` pack archive handling, merged from `apps/vscode/src/packs/archive-packs.ts`
 * and `apps/obsidian/src/packs/archive-packs.ts`. It exports
 * `describeArchiveError`, `writeArchiveContents` and `ArchiveExtractFs`.
 *
 * This module bridges `@markii/pack`'s in-memory archive reader
 * (`openPackArchive`, never modified here) into the write a pack install
 * needs: extracting a validated archive's contents onto disk, under
 * whichever install root the calling host names (`HostPackSource.installRoot`).
 *
 * Environment-free (`ArchiveExtractFs` is an injected seam). The real
 * Node-backed one, `createNodeArchiveExtractFs`, lives in `../node-fs.ts`
 * and is exported from `@markii/host/node`.
 */
import { dirnamePath, joinPath } from '../path-util.js';
import type { PackArchiveContents, PackArchiveError } from '@markii/pack';

/** One line describing why `openPackArchive` rejected an archive, for a host's install-diagnostics wording. Passes `kind: 'zip'`'s and `kind: 'missing-entry'`'s message through verbatim (already specific); summarizes a manifest failure plainly. */
export function describeArchiveError(error: PackArchiveError): string {
  if (error.kind === 'zip') return error.message;
  if (error.kind === 'missing-entry') return error.message;
  return `invalid pack.json in archive (${error.errors.join('; ')})`;
}

/** The filesystem write seam `writeArchiveContents` needs (`./pack-install.ts`). Deliberately narrow: extracting an archive only ever creates files under a directory it first clears, it never reads back or deletes anything else. */
export interface ArchiveExtractFs {
  /** Removes `absolutePath` and everything under it, or resolves quietly if it does not exist. Never rejects: a directory that fails to clear is treated the same as a fresh one, and the write that follows fails loudly on its own if the path is genuinely unusable. */
  readonly removeDirectory: (absolutePath: string) => Promise<void>;
  /** Creates a directory and any missing parents. May reject on a genuine I/O failure. */
  readonly makeDirectory: (absolutePath: string) => Promise<void>;
  readonly writeFile: (
    absolutePath: string,
    bytes: Uint8Array,
  ) => Promise<void>;
}

/**
 * Writes a validated archive's contents into `destinationDir`: `pack.json`
 * (the parsed manifest, re-serialized: `openPackArchive` keeps only the
 * validated manifest fields, not the original bytes, so the written file
 * is a normalized round-trip of the same fields, not a byte-for-byte
 * copy), `webview.js`, `webview.css` and `terminal.js` when the archive has them, and
 * `scripts/*` when it ships any. Does NOT clear `destinationDir` first;
 * a caller that needs a clean re-extract (a reinstall replacing an
 * existing pack) calls `fs.removeDirectory` itself before this.
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
    joinPath(destinationDir, 'pack.json'),
    encoder.encode(JSON.stringify(archive.manifest, null, 2) + '\n'),
  );
  await fs.writeFile(
    joinPath(destinationDir, 'webview.js'),
    archive.scriptBytes,
  );
  if (archive.stylesheetBytes !== undefined) {
    await fs.writeFile(
      joinPath(destinationDir, 'webview.css'),
      archive.stylesheetBytes,
    );
  }
  if (archive.terminalScriptBytes !== undefined) {
    await fs.writeFile(
      joinPath(destinationDir, 'terminal.js'),
      archive.terminalScriptBytes,
    );
  }
  const moduleNames = Object.keys(archive.scriptModules);
  if (moduleNames.length > 0) {
    const scriptsDir = joinPath(destinationDir, 'scripts');
    for (const name of moduleNames) {
      const target = joinPath(scriptsDir, name);
      await fs.makeDirectory(dirnamePath(target));
      await fs.writeFile(target, archive.scriptModules[name]!);
    }
  }
}
