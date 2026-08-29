/**
 * Discovers the packs `markii.packs` currently names — cheaply, without
 * compiling anything. Shared by two commands that both only need "what
 * packs are configured": the export command (`./export-pack.ts`) and the
 * Insert Component command (GitHub issue #17, slice 1, `../insert-component.ts`
 * via `../extension.ts`). Deliberately not `./pack-context.ts`'s
 * `loadPackContext`: that function also loads Lua modules and resolves/
 * compiles a webview registration script for the PREVIEW path, neither of
 * which either caller here needs, so contorting it to serve every caller
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

/** Every discovered pack `markii.packs` currently names. */
export async function discoverConfiguredPacks(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
): Promise<readonly DiscoveredPack[]> {
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredPacks, workspaceRoot, homeDir);
  const result = await discoverPacks(folders, createNodeFileReader());
  return result.packs;
}
