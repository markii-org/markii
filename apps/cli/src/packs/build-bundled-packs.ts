/**
 * Build-time only (never part of the shipped CLI bundle): compiles the
 * bundled packs' TERMINAL views into `dist/packs/<name>/` (`pack.json`,
 * `terminal.js`, and the small empty `webview.js` an export always writes).
 * Run by `esbuild.config.mjs` once per CLI build, through `@markii/host`'s
 * own pack machinery (`discoverPacks`, `buildPackTerminalScript`,
 * `exportPack`), so there is one pack compiler, not a second one here.
 *
 * Only a pack whose manifest names `ansi` sources is built. A bundled pack
 * with none contributes no folder, so a CLI built before any bundled pack
 * has terminal views carries no `dist/packs` at all. A pack that has them
 * and fails to build fails the CLI build loudly: this is the repository's
 * own artifact, not a user's pack, which degrades quietly by design.
 *
 * The React views are not built: the CLI never runs them, and the
 * `webview.js` stub keeps the folder a valid pack.
 */
import { createNodeDirectoryLister } from '@markii/host/node';
import * as path from 'node:path';
import { discoverPacks, packHasTerminalViews } from '@markii/host';
import { createNodeFileReader } from '@markii/host/node';
import {
  buildPackTerminalScript,
  exportPack,
  type PackBuildOutcome,
  type PackExportFs,
} from '@markii/pack-build';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';

/** The packs that ship with the CLI, one folder each under the repo's `packs/`. */
export const BUNDLED_PACK_NAMES = ['read', 'dash', 'prep'] as const;

export interface BuildBundledPacksOptions {
  /** The repository root; `packs/<name>` is resolved against it. */
  readonly repoRoot: string;
  /** Where each pack lands (`apps/cli/dist/packs`). */
  readonly outDir: string;
  /** A throwaway build cache; the caller deletes it. */
  readonly cacheDir: string;
  /** Replaces the real compiler, for a test that must not start esbuild-wasm. */
  readonly buildTerminal?: (
    pack: Parameters<typeof buildPackTerminalScript>[0],
    cacheDir: string,
  ) => Promise<PackBuildOutcome>;
}

function nodeExportFs(): PackExportFs {
  return {
    exists: async (p) => {
      try {
        await access(p);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (p) => {
      try {
        return await readFile(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    writeFile: (p, text) => writeFile(p, text, 'utf8'),
    deleteFile: (p) => rm(p),
    makeDirectory: async (p) => {
      await mkdir(p, { recursive: true });
    },
    listDirectory: async (p) => {
      try {
        return await readdir(p);
      } catch {
        return [];
      }
    },
  };
}

/** Returns the names of the packs it built. Throws on the first failure. */
export async function buildBundledPacks(
  options: BuildBundledPacksOptions,
): Promise<string[]> {
  const { repoRoot, outDir, cacheDir } = options;
  const buildTerminal = options.buildTerminal ?? buildPackTerminalScript;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  const readText = createNodeFileReader();
  const fs = nodeExportFs();
  const built: string[] = [];

  for (const name of BUNDLED_PACK_NAMES) {
    const folder = path.join(repoRoot, 'packs', name);
    const result = await discoverPacks(
      [folder],
      readText,
      createNodeDirectoryLister(),
    );
    const pack = result.packs[0];
    if (pack === undefined) {
      const reasons = result.skipped.map((entry) => entry.reason).join('; ');
      throw new Error(
        `bundled pack "${name}" (${folder}) failed to discover: ${reasons || 'no readable pack.json'}`,
      );
    }
    if (pack.manifest.name !== name) {
      throw new Error(
        `bundled pack folder "${name}" declares pack.json name "${pack.manifest.name}"; the folder name and the manifest name must match.`,
      );
    }
    if (!packHasTerminalViews(pack)) continue;

    await mkdir(outDir, { recursive: true });
    const outcome = await exportPack({
      pack,
      cacheDir,
      destinationDir: outDir,
      exportName: name,
      build: async () => ({ kind: 'skipped' }),
      buildTerminal,
      fs,
      confirmOverwrite: async () => true,
    });
    if (outcome.kind !== 'written') {
      const reason =
        outcome.kind === 'failed' ? outcome.reason : 'export was cancelled';
      throw new Error(`bundled pack "${name}" failed to build: ${reason}`);
    }
    built.push(name);
  }
  return built;
}
