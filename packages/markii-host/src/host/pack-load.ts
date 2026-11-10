/**
 * The shared discovery path behind `loadPacks`, merged from
 * `apps/vscode/src/packs/discover-configured-packs.ts` and
 * `apps/obsidian/src/packs/discover-configured-packs.ts` plus the discovery-and-namespace-collection half both apps'
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
import type { UnavailableComponent } from '@markii/stdlib';
import {
  componentsWithoutEngineView,
  declaredPackComponents,
  discoverPacks,
  installedNamespaces,
} from '../packs/discover.js';
import type {
  DiscoveredPack,
  PackDirectoryLister,
  PackFileReader,
  SkippedPackFolder,
} from '../packs/discover.js';
import type { HostAdapter, HostPackSource } from './adapter.js';

/** The two file-system reads pack discovery needs, injected so this module has no Node dependency. */
export interface PackDiscoveryIo {
  readonly readFile: PackFileReader;
  readonly listDirectory: PackDirectoryLister;
}

/**
 * Discovery reads derived from the adapter's own `readFile` and
 * `listFolder`. Both are held to discovery's never-rejects contract: an
 * unreadable file is `undefined`, an unreadable folder is `[]`.
 */
export function packDiscoveryIoFromAdapter(
  adapter: Pick<HostAdapter, 'readFile' | 'listFolder'>,
): PackDiscoveryIo {
  return {
    readFile: async (absolutePath) => {
      try {
        return new TextDecoder().decode(await adapter.readFile(absolutePath));
      } catch {
        return undefined;
      }
    },
    listDirectory: async (absoluteDir) => {
      try {
        return [...(await adapter.listFolder(absoluteDir))];
      } catch {
        return [];
      }
    },
  };
}

export interface LoadPacksResult {
  readonly packs: readonly DiscoveredPack[];
  readonly skipped: readonly SkippedPackFolder[];
  readonly namespaces: readonly string[];
  /**
   * Every component of every installed pack, including a pack dropped whole
   * because it has nothing for this engine, with the engines each one has a
   * view for. A host passes it to an engine that draws NO pack views, such
   * as the static HTML export.
   */
  readonly components: readonly UnavailableComponent[];
  /**
   * The subset of `components` with no view for this host's engine: the list
   * a host passes to its renderer's `unavailableComponents` option, so a
   * note using one says "no view here" instead of "unknown component".
   */
  readonly unavailable: readonly UnavailableComponent[];
}

/**
 * Discovers every pack under `folders`, engine-gated against
 * `engine` (the host's renderer engine id, given by the caller) — the same
 * posture a renderer's pack loader takes for an unsupported `engine`, so
 * neither Insert Component nor completion ever offers a component this
 * renderer could not render.
 */
export async function discoverConfiguredPacks(
  folders: readonly string[],
  io: PackDiscoveryIo,
  engine: string,
): Promise<LoadPacksResult> {
  const result = await discoverPacks(
    folders,
    io.readFile,
    io.listDirectory,
    engine,
  );
  const components = [
    ...result.packs.flatMap((pack) => declaredPackComponents(pack.manifest)),
    ...result.skipped.flatMap(
      (entry) => entry.engineUnsupported?.components ?? [],
    ),
  ];
  return {
    packs: result.packs,
    skipped: result.skipped,
    namespaces: installedNamespaces(result.packs),
    components,
    unavailable: componentsWithoutEngineView(components, engine),
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
  io: PackDiscoveryIo,
): Promise<LoadPacksResult> {
  const folders = await source.authorizedFolders();
  return discoverConfiguredPacks(folders, io, source.engine);
}
