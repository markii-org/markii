/**
 * The extension's own bundled packs (`packs/read`, `packs/dash`,
 * `packs/prep` at the repo root — AGENTS.md's "Bundled packs", GitHub
 * issue #15), compiled at extension BUILD time into `dist/packs/<name>/`
 * by `esbuild.config.mjs`'s `buildBundledPacks` (which runs
 * `./build-bundled-packs.ts`, the compiler; this module is the RUNTIME
 * half a loaded extension uses to find and merge them). Always present in
 * a packaged extension, ordered AHEAD of the user's `markii.packs`
 * entries.
 *
 * `discoverBundledPacks` reuses `@markii/host`'s `discoverPacks` unchanged
 * — `dist/packs` has exactly the shape that function's one-level
 * parent-folder scan already expects (one subfolder per pack, each with
 * its own `pack.json`), the same shape a user's own parent `markii.packs`
 * entry gets.
 *
 * `mergeBundledPacks` is the piece `discoverPacks` cannot do on its own:
 * its own collision rule drops BOTH packs sharing a namespace, which is
 * the wrong outcome between a bundled pack and a user one. Here the
 * bundled pack always wins: a same-namespace user pack is dropped and
 * reported in `skipped`, never the reverse.
 */
import * as path from 'node:path';
import { createNodeFileReader, discoverPacks } from '@markii/host';
import type { DiscoveredPack, SkippedPackFolder } from '@markii/host';

/** `dist/packs`, relative to the extension's own install directory (`ExtensionContext.extensionUri.fsPath`). */
export function bundledPacksFolder(extensionPath: string): string {
  return path.join(extensionPath, 'dist', 'packs');
}

/**
 * Every bundled pack the packaged extension ships, or `[]` when
 * `dist/packs` does not exist yet (a dev/test run before the build step,
 * or a build that has not produced any bundled pack for some reason) —
 * quiet, matching every other pack-discovery failure mode in this package.
 */
export async function discoverBundledPacks(
  extensionPath: string,
): Promise<readonly DiscoveredPack[]> {
  const result = await discoverPacks(
    [bundledPacksFolder(extensionPath)],
    createNodeFileReader(),
  );
  return result.packs;
}

export interface MergedPacks {
  /** Every bundled pack, in order, followed by every user pack whose namespace does not collide with one of them. */
  readonly packs: readonly DiscoveredPack[];
  /** One entry per user pack dropped because a bundled pack already claims its namespace. */
  readonly skipped: readonly SkippedPackFolder[];
}

/** The diagnostics-line wording for a user pack dropped in favor of a bundled one — `./pack-diagnostics.ts` writes this to the Markii output channel like any other skipped-folder reason. */
function bundledWinsReason(namespace: string): string {
  return `pack namespace "${namespace}" is already provided by a bundled pack; the configured pack was skipped. A bundled pack always wins a namespace collision.`;
}

/**
 * Merges the always-present bundled packs ahead of the user's configured
 * packs. A user pack sharing a bundled pack's namespace is dropped (never
 * both sides, unlike `discoverPacks`'s own collision rule) and recorded in
 * `skipped`, so it reaches the Markii output channel the same way any
 * other skipped pack folder does.
 */
export function mergeBundledPacks(
  bundled: readonly DiscoveredPack[],
  userPacks: readonly DiscoveredPack[],
): MergedPacks {
  const bundledNamespaces = new Set(bundled.map((pack) => pack.manifest.name));
  const skipped: SkippedPackFolder[] = [];
  const kept: DiscoveredPack[] = [];
  for (const pack of userPacks) {
    if (bundledNamespaces.has(pack.manifest.name)) {
      skipped.push({
        folder: pack.folder,
        reason: bundledWinsReason(pack.manifest.name),
      });
      continue;
    }
    kept.push(pack);
  }
  return { packs: [...bundled, ...kept], skipped };
}
