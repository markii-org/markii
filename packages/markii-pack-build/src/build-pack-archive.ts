/**
 * `buildPackArchive`: one call from a pack folder to the bytes of its
 * `.mkp` archive. It discovers the pack in the folder, compiles its React
 * views and, when the pack has terminal views, its terminal script, and
 * zips the result. A build script needs this and nothing else from
 * `@markii/host`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { discoverPacks } from '@markii/host/internal';
import {
  buildPackRegistrationScript,
  buildPackTerminalScript,
} from './pack-build.js';
import { exportPackArchive } from './pack-export-archive.js';

export interface BuildPackArchiveOptions {
  /**
   * A folder this caller owns, where compiled scripts are cached. It is
   * never the pack's own folder. Defaults to `markii-pack-build` under the
   * operating system's temporary folder.
   */
  readonly cacheDir?: string;
}

export type BuildPackArchiveOutcome =
  | {
      readonly kind: 'built';
      /** The `.mkp` archive's bytes. */
      readonly bytes: Uint8Array;
      /** `<name>-<version>.mkp`, or `<name>.mkp` when the manifest declares no version. */
      readonly fileName: string;
      /** The build's pack-CSS lint warnings. Empty when there are none. */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'failed'; readonly reason: string };

async function readText(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function listEntries(
  absoluteDir: string,
): Promise<{ name: string; isDirectory: boolean }[]> {
  try {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the `.mkp` archive for the one pack in `packFolder`. The folder
 * either holds a `pack.json` itself or holds exactly one child folder that
 * does. Zero packs, several packs and an invalid pack are all `failed`,
 * with the reason discovery gave. Never throws, and never writes into
 * `packFolder`: the build is cached under `options.cacheDir`.
 *
 * The compiled scripts live in that cache until the next build.
 * `buildPackRegistrationScript` and `buildPackTerminalScript` return paths
 * into it, and those paths are valid only until the next build replaces
 * them. This function reads them back before it returns, so its result
 * holds bytes, not paths.
 */
export async function buildPackArchive(
  packFolder: string,
  options: BuildPackArchiveOptions = {},
): Promise<BuildPackArchiveOutcome> {
  try {
    const cacheDir =
      options.cacheDir ?? path.join(tmpdir(), 'markii-pack-build');
    const discovered = await discoverPacks([packFolder], readText, listEntries);
    if (discovered.packs.length === 0) {
      const reasons = discovered.skipped.map((entry) => entry.reason);
      return {
        kind: 'failed',
        reason:
          reasons.length > 0
            ? `no pack could be built from "${packFolder}": ${reasons.join('; ')}`
            : `no pack was found in "${packFolder}"`,
      };
    }
    if (discovered.packs.length > 1) {
      return {
        kind: 'failed',
        reason: `"${packFolder}" holds ${String(discovered.packs.length)} packs, and a build takes one`,
      };
    }
    const pack = discovered.packs[0]!;
    const built = await exportPackArchive({
      pack,
      cacheDir,
      build: buildPackRegistrationScript,
      buildTerminal: buildPackTerminalScript,
      fs: { readFile: readText, listDirectory: listFileNames },
    });
    if (built.kind === 'failed') {
      return { kind: 'failed', reason: built.reason };
    }
    return {
      kind: 'built',
      bytes: built.bytes,
      fileName: built.fileName,
      warnings: built.warnings,
    };
  } catch (error) {
    return { kind: 'failed', reason: describeThrown(error) };
  }
}

async function listFileNames(absoluteDir: string): Promise<string[]> {
  try {
    return await readdir(absoluteDir);
  } catch {
    return [];
  }
}
