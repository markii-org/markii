/**
 * Discovers the installed, trusted packs this device currently loads —
 * cheaply, without evaluating any script or reading any Lua module. Used
 * by the Insert Component command and directive completion
 * (`../main.ts`), which only need a pack's manifest (its component names
 * and attributes), the same cheap shape VS Code's
 * `apps/vscode/src/packs/discover-configured-packs.ts` uses.
 *
 * `obsidian`-free (plain paths in, `DiscoveredPack[]` out) so it stays
 * unit-testable without a real vault. Archive-only, no compiler
 * (AGENTS.md's Host positioning): `installedFolders` is already the
 * resolved, absolute, trusted set of pack folders (`./installed-packs.ts`'s
 * `selectLoadablePackFolders`) — this module does no path resolution and
 * knows nothing about the trust list itself.
 */
import { createNodeFileReader, discoverPacks } from '@markii/host';
import type { DiscoveredPack } from '@markii/host';

/** Every discovered pack under `installedFolders` — this caller (Insert Component, directive completion) only ever needs a pack's component names and attributes, never its script or Lua modules. */
export async function discoverConfiguredPacks(
  installedFolders: readonly string[],
): Promise<readonly DiscoveredPack[]> {
  const result = await discoverPacks(installedFolders, createNodeFileReader());
  return result.packs;
}
