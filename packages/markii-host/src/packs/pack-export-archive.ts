/**
 * The archive-producing counterpart of `./pack-export.ts`'s `exportPack`
 * (GitHub issue #16): compiles a pack through the SAME build cache and
 * zips its distributable form (`pack.json`, `webview.js`, `webview.css`
 * when built, `scripts/*.lua`) into a single `.mkp` file's bytes, named
 * per `@markii/pack`'s `packArchiveFileName`. VS Code is the authoring
 * host and owns pack packaging; this is the second of the two shapes
 * "Markii: Export Pack" offers, `exportPack` above being the folder shape.
 *
 * Uses `fflate`'s `zipSync`, already a runtime dependency of this package
 * (`packages/markii-host/package.json`; `@markii/bundle`'s own zip reader
 * is built on the same library), so this adds no new dependency. The
 * result is a PLAIN zip at the archive root, not a `@markii/bundle`
 * bundle: a `.mkp` carries no `manifest.json`/bundle semantics of its own,
 * just the flat layout `@markii/pack`'s `openPackArchive` reads back.
 *
 * The pack's own source folder is never written to, exactly like
 * `exportPack`. This function never writes anywhere at all: it only reads
 * (the pack's own `pack.json`, the build output, the `scripts/` folder)
 * and returns bytes; a caller's `vscode`-specific wiring decides where the
 * user wants the `.mkp` saved and whether to confirm an overwrite there.
 */
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { packArchiveFileName } from '@markii/pack';
import type { DiscoveredPack } from './discover.js';
import type { PackBuildOutcome } from './pack-build.js';
import type { PackExportBuilder, PackExportFs } from './pack-export.js';

const MANIFEST_FILENAME = 'pack.json';
const SCRIPT_FILENAME = 'webview.js';
const STYLESHEET_FILENAME = 'webview.css';

export type PackExportArchiveOutcome =
  | {
      readonly kind: 'built';
      readonly packName: string;
      /** `<name>-<version>.mkp`, or `<name>.mkp` with no declared version; see `@markii/pack`'s `packArchiveFileName`. */
      readonly fileName: string;
      readonly bytes: Uint8Array;
      readonly scriptBytes: number;
      readonly stylesheetBytes?: number;
      /** How many `*.lua` files from the pack's `scripts/` directory were included. 0 when it has none. */
      readonly scriptFilesCopied: number;
      /** The build's pack-CSS lint warnings, passed through unchanged. */
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: 'failed';
      readonly packName: string;
      readonly reason: string;
    };

export interface ExportPackArchiveOptions {
  readonly pack: DiscoveredPack;
  /** The host-owned build cache directory: the build still runs through the normal cache, only its output is zipped. */
  readonly cacheDir: string;
  readonly build: PackExportBuilder;
  /** Only the read half of `PackExportFs`: an archive export never writes anywhere on its own. */
  readonly fs: Pick<PackExportFs, 'readFile' | 'listDirectory'>;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function packNameOf(pack: DiscoveredPack): string {
  return pack.manifest.name;
}

/**
 * NEVER throws: every failure (an unreadable `pack.json`, a build failure,
 * an unreadable built script) comes back as `{ kind: 'failed', reason }`,
 * matching `exportPack`'s contract. There is no overwrite confirmation
 * here, unlike `exportPack`: nothing is written to any path by this
 * function, so "does the destination already have a file" is entirely the
 * caller's concern once it knows where the user wants the `.mkp` saved.
 */
export async function exportPackArchive(
  options: ExportPackArchiveOptions,
): Promise<PackExportArchiveOutcome> {
  const { pack, cacheDir, build, fs } = options;
  const packName = packNameOf(pack);

  let manifestText: string | undefined;
  try {
    manifestText = await fs.readFile(path.join(pack.folder, MANIFEST_FILENAME));
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
  if (manifestText === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `pack.json for pack "${packName}" could not be read`,
    };
  }

  let outcome: PackBuildOutcome;
  try {
    outcome = await build(pack, cacheDir);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
  if (outcome.kind === 'failed') {
    // Verbatim: the reason's one home is the caller's own diagnostics
    // module, matching `exportPack`'s identical posture.
    return { kind: 'failed', packName, reason: outcome.reason };
  }
  if (outcome.kind === 'skipped') {
    return {
      kind: 'failed',
      packName,
      reason: `pack "${packName}" was not built`,
    };
  }

  let scriptText: string | undefined;
  try {
    scriptText = await fs.readFile(outcome.scriptPath);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
  if (scriptText === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `built script for pack "${packName}" could not be read back`,
    };
  }

  let stylesheetText: string | undefined;
  if (outcome.stylesheetPath !== undefined) {
    try {
      stylesheetText = await fs.readFile(outcome.stylesheetPath);
    } catch {
      // A read failure here is treated as "no stylesheet" rather than
      // failing the whole export, matching `exportPack`.
      stylesheetText = undefined;
    }
  }

  let scriptEntries: readonly string[] = [];
  try {
    scriptEntries = await fs.listDirectory(pack.scriptsDir);
  } catch {
    scriptEntries = [];
  }
  const luaFilenames = scriptEntries.filter((name) => name.endsWith('.lua'));
  const luaFiles: Array<{ name: string; text: string }> = [];
  for (const filename of luaFilenames) {
    let text: string | undefined;
    try {
      text = await fs.readFile(path.join(pack.scriptsDir, filename));
    } catch {
      text = undefined;
    }
    if (text === undefined) continue; // unreadable individual file: quietly skipped
    luaFiles.push({ name: filename, text });
  }

  const encoder = new TextEncoder();
  const zipInput: Record<string, Uint8Array> = {
    [MANIFEST_FILENAME]: encoder.encode(manifestText),
    [SCRIPT_FILENAME]: encoder.encode(scriptText),
  };
  const scriptBytes = zipInput[SCRIPT_FILENAME]!.byteLength;
  let stylesheetBytes: number | undefined;
  if (stylesheetText !== undefined) {
    const encoded = encoder.encode(stylesheetText);
    zipInput[STYLESHEET_FILENAME] = encoded;
    stylesheetBytes = encoded.byteLength;
  }
  for (const file of luaFiles) {
    zipInput[`scripts/${file.name}`] = encoder.encode(file.text);
  }

  const bytes = zipSync(zipInput);

  return {
    kind: 'built',
    packName,
    fileName: packArchiveFileName(pack.manifest),
    bytes,
    scriptBytes,
    ...(stylesheetBytes !== undefined ? { stylesheetBytes } : {}),
    scriptFilesCopied: luaFiles.length,
    warnings: outcome.warnings,
  };
}
