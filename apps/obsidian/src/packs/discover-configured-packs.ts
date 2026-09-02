/**
 * Discovers the packs this device's pack-folder setting currently names —
 * cheaply, without compiling anything, and without loading Lua modules or
 * resolving/compiling a webview registration script for the preview path
 * (`./pack-context.ts`'s `loadPackContext` does all of that, for a
 * different caller). Used by the Insert Component command (GitHub issue
 * #17, slice 1, `../insert-component.ts` via `../main.ts`), which only
 * needs "what packs are configured" the same cheap way VS Code's
 * `apps/vscode/src/packs/discover-configured-packs.ts` does.
 *
 * `obsidian`-free (plain paths and strings in, `DiscoveredPack[]` out) so
 * it stays unit-testable without a real vault — mirrors `./pack-context.ts`'s
 * own resolution: `resolvePackPaths` against the vault root, same as the
 * preview path.
 */
import { homedir } from 'node:os';
import {
  createNodeFileReader,
  discoverPacks,
  resolvePackPaths,
} from '@markii/host';
import type { DiscoveredPack } from '@markii/host';
import {
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacksManifestOnly,
} from './archive-packs.js';

/**
 * Every discovered pack this device's pack-folder setting currently names,
 * including a `.mkp` archive entry (GitHub issue #16) resolved manifest-only
 * via `./archive-packs.ts`'s `resolveArchivePacksManifestOnly` — this
 * caller (Insert Component, directive completion) only ever needs a pack's
 * component names and attributes, never its script or Lua modules.
 */
export async function discoverConfiguredPacks(
  configuredFolders: readonly string[],
  vaultRoot: string | undefined,
): Promise<readonly DiscoveredPack[]> {
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredFolders, vaultRoot, homeDir);
  const { folderPaths, archivePaths } = partitionConfiguredPackPaths(folders);
  const result = await discoverPacks(folderPaths, createNodeFileReader());
  const archivePacks = await resolveArchivePacksManifestOnly(archivePaths);
  return mergeArchiveAndFolderPacks(result.packs, archivePacks).packs;
}
