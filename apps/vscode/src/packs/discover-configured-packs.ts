/**
 * Discovers the packs `markii.packs` currently names — cheaply, without
 * compiling anything. Shared by two commands that both only need "what
 * packs are configured": the export command (`./export-pack.ts`) and the
 * Insert Component command (GitHub issue #17, slice 1, `../insert-component.ts`
 * via `../extension.ts`), plus the completion/hover catalog
 * (`../completion-catalog.ts`). Deliberately not `./pack-context.ts`'s
 * `loadPackContext`: that function also loads Lua modules and resolves/
 * compiles a webview registration script for the PREVIEW path, neither of
 * which any caller here needs, so contorting it to serve every caller
 * would just make it harder to read for no benefit.
 *
 * `vscode`-free (plain paths and strings in, `DiscoveredPack[]` out) so it
 * stays unit-testable without a real workspace.
 */
import { homedir } from 'node:os';
import {
  createNodeFileReader,
  discoverPacks,
  resolvePackPaths,
} from '@markii/host';
import type { DiscoveredPack } from '@markii/host';
import { discoverBundledPacks, mergeBundledPacks } from './bundled-packs.js';
import {
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacksManifestOnly,
} from './archive-packs.js';

/**
 * Every discovered pack `markii.packs` currently names. When
 * `extensionPath` is given (`ExtensionContext.extensionUri.fsPath`), the
 * extension's own bundled packs (`./bundled-packs.ts`, GitHub issue #15)
 * are merged in ahead of them, bundled wins on a namespace collision. The
 * export command deliberately omits `extensionPath` — a bundled pack's
 * `dist/packs` output has no component SOURCES to export, only the
 * already-compiled `webview.js`, so it is never a candidate for "Markii:
 * Export Pack". Insert Component and the completion catalog both pass it,
 * so a bundled pack behaves as an ordinary pack there.
 *
 * A `.mkp` archive entry (GitHub issue #16) is resolved the same way a
 * bundled pack is: only when `extensionPath` is given, because, exactly
 * like a bundled pack, an archive ships no component sources either, so
 * it is never a candidate for "Markii: Export Pack" (`./export-pack.ts`
 * omits `extensionPath`). Manifest only, no extraction to disk: this
 * function's callers (the catalog, Insert Component) never read a pack's
 * `scriptPath`/`componentPaths` off disk, only its manifest.
 */
export async function discoverConfiguredPacks(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
  extensionPath?: string,
): Promise<readonly DiscoveredPack[]> {
  const homeDir = homedir();
  const resolvedPaths = resolvePackPaths(
    configuredPacks,
    workspaceRoot,
    homeDir,
  );
  const { folderPaths, archivePaths } =
    partitionConfiguredPackPaths(resolvedPaths);
  const result = await discoverPacks(folderPaths, createNodeFileReader());
  if (extensionPath === undefined) {
    return result.packs;
  }
  const archivePacks = await resolveArchivePacksManifestOnly(archivePaths);
  const combined = mergeArchiveAndFolderPacks(result.packs, archivePacks);
  const bundled = await discoverBundledPacks(extensionPath);
  return mergeBundledPacks(bundled, combined.packs).packs;
}
