/**
 * `.mkp` pack archives as a `markii.packs` entry (docs/packs.md, GitHub
 * issue #16): a configured pack path may name a `.mkp` FILE directly
 * rather than a folder. This module is the bridge between `@markii/pack`'s
 * in-memory archive reader (`openPackArchive`, already built and never
 * modified here) and the folder-shaped `DiscoveredPack` every pack-loading
 * module in `@markii/host` already expects.
 *
 * An archive is opened READ-ONLY and never modified. Loading it into a
 * live preview still needs real files on disk, though: the webview loads
 * `webview.js`/`webview.css` through `vscode.Uri.file(...)` +
 * `asWebviewUri`, and the Run path reads `scripts/*.lua` straight off disk
 * (`@markii/host`'s `pack-scripts.ts`), and neither has an in-memory code
 * path. So a `.mkp` used for the actual preview is materialized into this
 * extension's own pack-cache directory (`resolveArchivePacksForPreview`,
 * `preview-panel.ts`'s `packCacheDir`), never the workspace, never the
 * archive's own folder. The extracted copy is wiped and rewritten on every
 * load rather than diffed, so an edited `.mkp` (or an install replacing
 * one) never leaves stale files behind.
 *
 * Directive completion and Insert Component only ever need a pack's
 * MANIFEST (component names/attributes): see `@markii/host`'s
 * `insert/component-catalog.ts`, which never reads `componentPaths`,
 * `scriptsDir`, or `scriptPath` off disk. `resolveArchivePacksManifestOnly`
 * covers that case with no filesystem write at all: it opens the archive,
 * keeps the manifest, and returns a `DiscoveredPack` whose `folder`/
 * `scriptsDir`/`scriptPath` point at the `.mkp` file itself, informational
 * placeholders a catalog consumer never dereferences, not real paths a
 * webview could load.
 *
 * `writeArchiveContents` is the one piece both this module's preview path
 * and `./install-pack.ts`'s "Install Pack from File" command share: both
 * ultimately unzip a validated archive's contents into a directory, and
 * this is the single place that knows the on-disk layout (`pack.json`,
 * `webview.js`, optional `webview.css`, optional `scripts/*`).
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { openPackArchive } from '@markii/pack';
import type { PackArchiveContents, PackArchiveError } from '@markii/pack';
import { detectNamespaceCollisions } from '@markii/pack';
import type { DiscoveredPack, SkippedPackFolder } from '@markii/host';

/** The one file extension a pack archive uses. Matched case-insensitively, matching how `.mk.md`/`.mkz` are matched elsewhere in this extension. */
export const PACK_ARCHIVE_EXTENSION = '.mkp';

/** Whether `entry` names a `.mkp` archive rather than a pack folder. */
export function isPackArchivePath(entry: string): boolean {
  return entry.toLowerCase().endsWith(PACK_ARCHIVE_EXTENSION);
}

/** Splits already-resolved, absolute `markii.packs` entries into plain folder paths and `.mkp` archive paths. */
export function partitionConfiguredPackPaths(paths: readonly string[]): {
  readonly folderPaths: readonly string[];
  readonly archivePaths: readonly string[];
} {
  const folderPaths: string[] = [];
  const archivePaths: string[] = [];
  for (const entry of paths) {
    (isPackArchivePath(entry) ? archivePaths : folderPaths).push(entry);
  }
  return { folderPaths, archivePaths };
}

/** Reads a file's raw bytes, or `undefined` if it does not exist / cannot be read. Never rejects, injected so this module is testable without real disk. */
export type PackBytesReader = (
  absolutePath: string,
) => Promise<Uint8Array | undefined>;

/** The real, Node-backed `PackBytesReader`. */
export function createNodePackBytesReader(): PackBytesReader {
  return async (absolutePath) => {
    try {
      return new Uint8Array(await nodeReadFile(absolutePath));
    } catch {
      return undefined;
    }
  };
}

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

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Writes a validated archive's contents into `destinationDir`: `pack.json`
 * (the parsed manifest, re-serialized: `openPackArchive` keeps only the
 * validated manifest fields, not the original bytes, so the written file
 * is a normalized round-trip of the same fields, not a byte-for-byte
 * copy), `webview.js`, `webview.css` when the archive has one, and
 * `scripts/*` when it ships any. Does NOT clear `destinationDir` first;
 * callers that need a clean re-extract (an edited `.mkp`, a reinstall) call
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

/** A short, stable directory name for one archive path's extraction cache, so reopening the same `.mkp` reuses (and overwrites) the same cache folder instead of growing one per panel session. Content-independent on purpose: the cache is always wiped and rewritten on load (see this module's doc comment), so only the SOURCE PATH needs to be stable, not the archive's contents. */
function archiveCacheDirName(archivePath: string): string {
  return createHash('sha256')
    .update(path.resolve(archivePath))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Resolves every `.mkp` entry in `archivePaths` into a full, loadable
 * `DiscoveredPack` for the preview path: reads and validates each archive,
 * clears and rewrites its extraction cache folder under `archiveCacheDir`,
 * and points the returned pack's `folder`/`scriptsDir`/`scriptPath` at the
 * extracted copy. `webview.css` is picked up automatically once
 * `@markii/host`'s `resolvePrebuiltPack` later checks for a sibling on
 * disk, exactly like an ordinary prebuilt pack folder; this function does
 * not need to special-case it.
 *
 * `archiveCacheDir === undefined` (no pack-cache directory available, e.g.
 * a test harness that never wired one) skips every archive with a plain
 * reason rather than throwing: there is nowhere safe to extract into.
 */
export async function resolveArchivePacksForPreview(
  archivePaths: readonly string[],
  archiveCacheDir: string | undefined,
  readBytes: PackBytesReader = createNodePackBytesReader(),
  extractFs: ArchiveExtractFs = createNodeArchiveExtractFs(),
): Promise<{ packs: DiscoveredPack[]; skipped: SkippedPackFolder[] }> {
  const packs: DiscoveredPack[] = [];
  const skipped: SkippedPackFolder[] = [];

  for (const archivePath of archivePaths) {
    if (archiveCacheDir === undefined) {
      skipped.push({
        folder: archivePath,
        reason:
          'pack archive skipped: no pack-cache directory is available to extract it into',
      });
      continue;
    }

    const bytes = await readBytes(archivePath);
    if (bytes === undefined) {
      skipped.push({
        folder: archivePath,
        reason: `pack archive "${archivePath}" could not be read`,
      });
      continue;
    }

    const opened = await openPackArchive(bytes);
    if (!opened.ok) {
      skipped.push({
        folder: archivePath,
        reason: describeArchiveError(opened.error),
      });
      continue;
    }

    const targetDir = path.join(
      archiveCacheDir,
      archiveCacheDirName(archivePath),
    );
    try {
      await extractFs.removeDirectory(targetDir);
      await writeArchiveContents(opened.archive, targetDir, extractFs);
    } catch (err) {
      skipped.push({
        folder: archivePath,
        reason: `could not extract pack archive "${archivePath}": ${describeThrown(err)}`,
      });
      continue;
    }

    packs.push({
      folder: targetDir,
      manifest: opened.archive.manifest,
      componentPaths: {},
      scriptsDir: path.join(targetDir, 'scripts'),
      scriptPath: path.join(targetDir, 'webview.js'),
    });
  }

  return { packs, skipped };
}

/**
 * Resolves every `.mkp` entry in `archivePaths` for the completion/Insert
 * Component catalog only: manifest-only, no disk write, since
 * `buildComponentCatalog` never reads a `DiscoveredPack`'s paths off disk.
 * A `folder`/`scriptsDir`/`scriptPath` all pointing at the `.mkp` file
 * itself are informational placeholders, matching this module's own doc
 * comment: no caller of this function ever dereferences them as real
 * files.
 */
export async function resolveArchivePacksManifestOnly(
  archivePaths: readonly string[],
  readBytes: PackBytesReader = createNodePackBytesReader(),
): Promise<readonly DiscoveredPack[]> {
  const packs: DiscoveredPack[] = [];
  for (const archivePath of archivePaths) {
    const bytes = await readBytes(archivePath);
    if (bytes === undefined) continue;
    const opened = await openPackArchive(bytes);
    if (!opened.ok) continue;
    packs.push({
      folder: archivePath,
      manifest: opened.archive.manifest,
      componentPaths: {},
      scriptsDir: archivePath,
      scriptPath: archivePath,
    });
  }
  return packs;
}

/**
 * Combines packs discovered from plain folders with packs resolved from
 * `.mkp` archives, applying the SAME collision rule `@markii/host`'s
 * `discoverPacks` already applies within one set of folders (docs/packs.md:
 * "Installing two packs with the same namespace is rejected at install
 * time"; both sides of a collision are dropped, not just the second).
 * Needed because folder discovery and archive resolution run as two
 * separate steps in this extension, so a namespace collision BETWEEN the
 * two sources would otherwise go undetected.
 */
export function mergeArchiveAndFolderPacks(
  folderPacks: readonly DiscoveredPack[],
  archivePacks: readonly DiscoveredPack[],
): { packs: DiscoveredPack[]; skipped: SkippedPackFolder[] } {
  const combined = [...folderPacks, ...archivePacks];
  const collisionNamespaces = new Set(
    detectNamespaceCollisions(combined.map((pack) => pack.manifest.name)).map(
      (collision) => collision.namespace,
    ),
  );
  const packs = combined.filter(
    (pack) => !collisionNamespaces.has(pack.manifest.name),
  );
  const skipped: SkippedPackFolder[] = [];
  for (const pack of combined) {
    if (collisionNamespaces.has(pack.manifest.name)) {
      skipped.push({
        folder: pack.folder,
        reason: `pack namespace "${pack.manifest.name}" collides with another configured pack and was not installed`,
      });
    }
  }
  return { packs, skipped };
}
