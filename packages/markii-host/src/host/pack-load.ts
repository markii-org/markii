/**
 * The shared discovery path behind `loadPacks`, merged from
 * `apps/vscode/src/packs/discover-configured-packs.ts` and
 * `apps/obsidian/src/packs/discover-configured-packs.ts` (survey finding
 * A3) plus the discovery-and-namespace-collection half both apps'
 * `packs/pack-context.ts` also duplicate on top of it.
 *
 * Pack POLICY — which folders are even candidates before any content is
 * read — is irreducibly host-specific (VS Code's resolved `markii.packs`
 * setting merged with its bundled packs; Obsidian's trust-filtered
 * installed folders merged with ITS bundled packs) and stays entirely
 * app-side, behind `HostPackSource.authorizedFolders()`. Everything AFTER
 * that list exists — read each folder's `pack.json`, validate it, drop a
 * namespace collision, engine-gate against this renderer — was already the
 * identical one-line call to `../packs/discover.ts`'s `discoverPacks` in
 * both apps, and that is what this module is.
 *
 * This is the CHEAP catalog path (a pack's manifest only: names,
 * namespaces, component attributes), the same shape both apps' Insert
 * Component command and directive completion already used —
 * deliberately not the heavier `pack-context.ts` composition (which also
 * loads Lua modules and resolves or evaluates a webview registration
 * script), since neither of those is anything `loadPacks`'s cheap-catalog
 * callers need.
 */
import {
  createNodeFileReader,
  discoverPacks,
  installedNamespaces,
} from '../packs/discover.js';
import type { DiscoveredPack, SkippedPackFolder } from '../packs/discover.js';
import { REACT_ENGINE_ID } from '@markii/react';
import type { HostPackSource } from './adapter.js';

export interface LoadPacksResult {
  readonly packs: readonly DiscoveredPack[];
  readonly skipped: readonly SkippedPackFolder[];
  readonly namespaces: readonly string[];
}

/**
 * Discovers every pack under `folders`, engine-gated against
 * `REACT_ENGINE_ID` — the same posture `@markii/react`'s `loadPack`
 * already takes for an unsupported `engine`, so neither Insert Component
 * nor completion ever offers a component this renderer could not render.
 */
export async function discoverConfiguredPacks(
  folders: readonly string[],
): Promise<LoadPacksResult> {
  const result = await discoverPacks(
    folders,
    createNodeFileReader(),
    undefined,
    REACT_ENGINE_ID,
  );
  return {
    packs: result.packs,
    skipped: result.skipped,
    namespaces: installedNamespaces(result.packs),
  };
}

/**
 * Runs `discoverConfiguredPacks` over `source.authorizedFolders()`. The
 * caller (`createMarkiiHost`'s `loadPacks`) checks that
 * `adapter.packs` exists before calling this — a host with no `packs`
 * capability at all returns `Unsupported` first and never reaches here.
 */
export async function loadPacksViaAdapter(
  source: HostPackSource,
): Promise<LoadPacksResult> {
  const folders = await source.authorizedFolders();
  return discoverConfiguredPacks(folders);
}
