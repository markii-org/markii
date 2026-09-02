/**
 * `.mkp` pack archives as an entry in this plugin's device-local pack-folder
 * list (docs/packs.md, GitHub issue #16): a configured entry may name a
 * `.mkp` FILE directly rather than a folder. This module bridges
 * `@markii/pack`'s in-memory archive reader (`openPackArchive`, already
 * built and never modified here) into the shapes `./pack-context.ts` and
 * `./discover-configured-packs.ts` already know how to fold into their own
 * pipelines.
 *
 * Unlike `apps/vscode`'s equivalent, this module never extracts an archive
 * to disk for the PREVIEW path. VS Code's webview has to load
 * `webview.js`/`webview.css` through `vscode.Uri.file(...)`, and its Run
 * path reads `scripts/*.lua` straight off disk, so it has no in-memory code
 * path for either. This plugin has neither of those: `./pack-runtime.ts`
 * evaluates a pack's compiled script text directly with `new Function(...)`
 * in the same JavaScript context the preview already runs in, and shared
 * Lua modules are threaded through as plain strings
 * (`@markii/host`'s `PackModulesMap`). So a `.mkp`'s validated contents —
 * `resolveArchivePacks` below — go straight from bytes to
 * `./pack-context.ts`'s in-memory pipeline, with nothing written to disk at
 * all. "Install pack from file" (`./install-pack.ts`) is the one place this
 * plugin DOES write an archive to disk, and it is a genuinely different
 * operation: making a copy the user can point a NEW pack-folder entry at,
 * not loading the one they already configured.
 *
 * `resolveArchivePacksManifestOnly` covers the cheap catalog case
 * (`./discover-configured-packs.ts`, Insert Component and directive
 * completion): those only ever need a pack's manifest, never its script or
 * Lua modules, so it skips decoding those entirely.
 *
 * `mergeArchiveAndFolderPacks` applies the SAME namespace-collision rule
 * `@markii/host`'s `discoverPacks` already applies within one set of
 * folders (docs/packs.md: "Installing two packs with the same namespace is
 * rejected at install time" — both claimants are dropped, not just the
 * second). It is needed here because folder discovery and archive
 * resolution run as two separate steps, so a collision BETWEEN the two
 * sources would otherwise go undetected — the same reason
 * `apps/vscode/src/packs/archive-packs.ts` has a function of the same name
 * and shape.
 *
 * `obsidian`-free: plain paths and strings in, `@markii/host`/`@markii/pack`
 * types out, so this stays unit-testable without a real vault.
 */
import * as path from 'node:path';
import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { openPackArchive, detectNamespaceCollisions } from '@markii/pack';
import type { PackArchiveContents, PackArchiveError } from '@markii/pack';
import type { DiscoveredPack, SkippedPackFolder } from '@markii/host';

/** The one file extension a pack archive uses. Matched case-insensitively, matching how `.mk.md`/`.mkz` are matched elsewhere in this plugin. */
export const PACK_ARCHIVE_EXTENSION = '.mkp';

/** Whether `entry` names a `.mkp` archive rather than a pack folder. */
export function isPackArchivePath(entry: string): boolean {
  return entry.toLowerCase().endsWith(PACK_ARCHIVE_EXTENSION);
}

/** Splits already-resolved, absolute pack-folder-list entries into plain folder paths and `.mkp` archive paths, preserving order within each. */
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

/** Reads a file's raw bytes, or `undefined` if it does not exist / cannot be read. Never rejects — injected so this module is testable without real disk. */
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

/** One line describing why `openPackArchive` rejected an archive, for this plugin's `skipped` / diagnostics wording. Passes `kind: 'zip'`'s and `kind: 'missing-entry'`'s message through verbatim (already specific); summarizes a manifest failure plainly. */
export function describeArchiveError(error: PackArchiveError): string {
  if (error.kind === 'zip') return error.message;
  if (error.kind === 'missing-entry') return error.message;
  return `invalid pack.json in archive (${error.errors.join('; ')})`;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Decodes UTF-8 bytes, rejecting anything that is not well-formed UTF-8
 * rather than silently substituting replacement characters — matches
 * `@markii/pack`'s own `archive.ts` posture for `pack.json`, applied here
 * to a script or stylesheet's text.
 */
function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** One `.mkp` archive resolved into the shape `./pack-context.ts`'s existing pipeline already knows how to evaluate and merge — the same shape `./bundled-packs.ts`'s `ResolvedBundledPack` uses for the same reason. */
export interface ResolvedArchivePack {
  readonly pack: DiscoveredPack;
  readonly scriptText: string;
  readonly cssText: string | undefined;
  readonly luaModules: Readonly<Record<string, string>>;
}

export interface ResolveArchivePacksResult {
  readonly resolved: readonly ResolvedArchivePack[];
  readonly skipped: readonly SkippedPackFolder[];
}

/**
 * Resolves every `.mkp` entry in `archivePaths` for the live preview path:
 * reads and validates each archive and decodes its script, optional
 * stylesheet, and any shared Lua modules to text, entirely in memory. A
 * `.mkp` that fails to read, fails validation, or decodes to something
 * other than well-formed UTF-8 is recorded in `skipped` with a plain
 * reason and excluded from `resolved` — never thrown, matching every other
 * step `loadPackContext` composes.
 */
export async function resolveArchivePacks(
  archivePaths: readonly string[],
  readBytes: PackBytesReader = createNodePackBytesReader(),
): Promise<ResolveArchivePacksResult> {
  const resolved: ResolvedArchivePack[] = [];
  const skipped: SkippedPackFolder[] = [];

  for (const archivePath of archivePaths) {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readBytes(archivePath);
    } catch (err) {
      skipped.push({
        folder: archivePath,
        reason: `pack archive "${archivePath}" could not be read: ${describeThrown(err)}`,
      });
      continue;
    }
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
    const archive = opened.archive;

    const scriptText = decodeUtf8Strict(archive.scriptBytes);
    if (scriptText === undefined) {
      skipped.push({
        folder: archivePath,
        reason: `pack archive "${archivePath}" webview.js is not valid UTF-8`,
      });
      continue;
    }

    const cssText =
      archive.stylesheetBytes !== undefined
        ? decodeUtf8Strict(archive.stylesheetBytes)
        : undefined;

    const luaModules: Record<string, string> = {};
    for (const [name, moduleBytes] of Object.entries(archive.scriptModules)) {
      const text = decodeUtf8Strict(moduleBytes);
      if (text !== undefined) luaModules[name] = text;
    }

    resolved.push({
      pack: {
        folder: archivePath,
        manifest: archive.manifest,
        componentPaths: {},
        scriptsDir: archivePath,
        scriptPath: archivePath,
      },
      scriptText,
      cssText,
      luaModules,
    });
  }

  return { resolved, skipped };
}

/**
 * Resolves every `.mkp` entry in `archivePaths` for the completion / Insert
 * Component catalog only: manifest-only, no script or Lua decoding, since
 * `@markii/host`'s `buildComponentCatalog` never reads a `DiscoveredPack`'s
 * script or Lua modules. Never throws; a `.mkp` that fails to read or
 * validate is simply excluded, matching `discoverConfiguredPacks`'s
 * existing "a bad entry is skipped, not thrown" posture.
 */
export async function resolveArchivePacksManifestOnly(
  archivePaths: readonly string[],
  readBytes: PackBytesReader = createNodePackBytesReader(),
): Promise<readonly DiscoveredPack[]> {
  const packs: DiscoveredPack[] = [];
  for (const archivePath of archivePaths) {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readBytes(archivePath);
    } catch {
      continue;
    }
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
 * `.mkp` archives, applying the same collision rule `@markii/host`'s
 * `discoverPacks` already applies within one set of folders. Needed because
 * folder discovery and archive resolution run as two separate steps in this
 * plugin, so a namespace collision BETWEEN the two sources would otherwise
 * go undetected.
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
