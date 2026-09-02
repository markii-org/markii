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

/**
 * Every discovered pack `markii.packs` currently names — every entry a
 * plain pack folder (source or prebuilt). When `extensionPath` is given
 * (`ExtensionContext.extensionUri.fsPath`), the extension's own bundled
 * packs (`./bundled-packs.ts`, GitHub issue #15) are merged in ahead of
 * them, bundled wins on a namespace collision. The export command
 * deliberately omits `extensionPath` — a bundled pack's `dist/packs`
 * output has no component SOURCES to export, only the already-compiled
 * `webview.js`, so it is never a candidate for "Markii: Export Pack".
 * Insert Component and the completion catalog both pass it, so a bundled
 * pack behaves as an ordinary pack there.
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
  const result = await discoverPacks(resolvedPaths, createNodeFileReader());
  if (extensionPath === undefined) {
    return result.packs;
  }
  const bundled = await discoverBundledPacks(extensionPath);
  return mergeBundledPacks(bundled, result.packs).packs;
}
