/**
 * Composes the pack-loading pieces (`./resolve-pack-paths.ts`,
 * `./discover.ts`, `./pack-scripts.ts`) into the one thing `preview-panel.ts`
 * needs: everything about the currently configured, installed packs, loaded
 * once per panel. `vscode`-free — every `vscode`-specific step (reading the
 * `markii.packs` setting, resolving `asWebviewUri`) stays in
 * `preview-panel.ts`; this module only takes the already-read setting value
 * and workspace root as plain strings.
 */
import { existsSync } from 'node:fs';
import {
  createNodeFileReader,
  discoverPacks,
  installedNamespaces,
} from './discover.js';
import type { DiscoveredPack, SkippedPackFolder } from './discover.js';
import { loadPackModules } from './pack-scripts.js';
import type { PackModulesMap } from './lua-resolver.js';
import { resolvePackPaths } from './resolve-pack-paths.js';

export interface PackContext {
  /** Every validated, non-colliding discovered pack. */
  readonly packs: readonly DiscoveredPack[];
  /** Pre-read `scripts/*.lua` source for every discovered pack, for the Run path's `PackModuleResolver` (`./lua-resolver.ts`). */
  readonly packModules: PackModulesMap;
  /** The subset of `packs` that actually ship a `webview.js` registration script (`./discover.ts`'s `webviewScriptPath` doc comment) — what the webview's `<script src=...>` tags load. A pack with no such file still counts toward `packs`/`packModules` (its Lua modules and namespace are real) but contributes nothing to the webview UI. */
  readonly webviewPacks: readonly DiscoveredPack[];
  /** Every discovered pack's namespace — what `resolveUses` (`@markii/pack`) checks a note's `uses:` declaration against. */
  readonly namespaces: readonly string[];
  /** Configured folders that produced no usable pack, and why (developer-facing only). */
  readonly skipped: readonly SkippedPackFolder[];
}

/**
 * Loads everything about the packs named by `configuredPacks` (the
 * `markii.packs` setting's raw value) resolved against `workspaceRoot` (see
 * `./resolve-pack-paths.ts`). Never throws: every step it composes already
 * degrades quietly (a missing/invalid manifest is skipped, a missing
 * `scripts/` directory contributes no modules, a missing `webview.js` just
 * excludes that pack from `webviewPacks`).
 */
export async function loadPackContext(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
): Promise<PackContext> {
  const folders = resolvePackPaths(configuredPacks, workspaceRoot);
  const result = await discoverPacks(folders, createNodeFileReader());
  const packModules = await loadPackModules(result.packs);
  const webviewPacks = result.packs.filter((pack) =>
    existsSync(pack.webviewScriptPath),
  );

  return {
    packs: result.packs,
    packModules,
    webviewPacks,
    namespaces: installedNamespaces(result.packs),
    skipped: result.skipped,
  };
}
