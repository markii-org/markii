/**
 * The BUILD-TIME compiler for the extension's bundled packs (`packs/read`,
 * `packs/dash`, `packs/prep` at the repo root — AGENTS.md's "Bundled
 * packs", GitHub issue #15). `esbuild.config.mjs`'s `buildBundledPacks`
 * bundles this module to a throwaway CJS file (the same
 * `@markii/*` -> `src/` alias every other bundle in that file uses) and
 * runs it once per extension build, producing `dist/packs/<name>/`
 * (`pack.json`, `webview.js`, `webview.css` when the build emits one, and
 * `scripts/*.lua` when the pack ships any). `./bundled-packs.ts` is the
 * RUNTIME half that discovers and merges this output back in.
 *
 * Deliberately reuses `@markii/host`'s pack machinery end to end —
 * `discoverPacks` (manifest validation), `buildPackRegistrationScript`
 * (the esbuild-wasm compiler), and `exportPack` (the compile-then-write
 * path the `markii.exportPack` command already runs) — rather than a
 * second pack compiler living only in the build script. `./export-pack.ts`'s
 * `createNodePackExportFs` is imported directly: it has no `vscode`
 * dependency of its own, so this module stays clean of one too.
 */
import * as path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import {
  buildPackRegistrationScript,
  createNodeFileReader,
  discoverPacks,
  exportPack,
} from '@markii/host';
import { createNodePackExportFs } from './export-pack.js';

/**
 * Folder names under the repo root's `packs/` that ship with the
 * extension. Each folder's own `pack.json` `name` field matches (verified
 * indirectly: `discoverPacks` below fails the build otherwise, since the
 * resulting `dist/packs/<name>` export name would silently diverge from
 * the pack's real namespace).
 */
export const BUNDLED_PACK_NAMES = ['read', 'dash', 'prep'] as const;

export interface BuildBundledPacksOptions {
  /** The repository root — `packs/<name>` is resolved against this. */
  readonly repoRoot: string;
  /** Where each pack lands, one subfolder per pack name (`apps/vscode/dist/packs`). Cleared and recreated per pack, so a file removed from a newer build never lingers. */
  readonly outDir: string;
  /** A throwaway build-time cache for `buildPackRegistrationScript`'s content-hash cache — the caller deletes this once the build resolves. */
  readonly cacheDir: string;
}

/**
 * Compiles every bundled pack into `outDir/<name>/`, in order. Throws on
 * the first failure: a broken bundled pack (a malformed `pack.json`, a
 * component that fails to compile) must fail the extension build loudly,
 * never ship silently degraded — unlike a USER's own pack, which degrades
 * quietly by design (AGENTS.md's cleanliness rule is about the rendered
 * note and the user's file tree, not about this repository's own build
 * shipping a broken artifact).
 */
export async function buildBundledPacks(
  options: BuildBundledPacksOptions,
): Promise<void> {
  const { repoRoot, outDir, cacheDir } = options;
  await mkdir(outDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const readFile = createNodeFileReader();
  const fs = createNodePackExportFs();

  for (const name of BUNDLED_PACK_NAMES) {
    const folder = path.join(repoRoot, 'packs', name);
    const result = await discoverPacks([folder], readFile);
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

    const packOutDir = path.join(outDir, name);
    await rm(packOutDir, { recursive: true, force: true });

    const outcome = await exportPack({
      pack,
      cacheDir,
      destinationDir: outDir,
      exportName: name,
      build: (source, dir) => buildPackRegistrationScript(source, dir),
      fs,
      confirmOverwrite: async () => true,
    });

    if (outcome.kind !== 'written') {
      const reason =
        outcome.kind === 'failed' ? outcome.reason : 'export was cancelled';
      throw new Error(`bundled pack "${name}" failed to build: ${reason}`);
    }
  }
}
