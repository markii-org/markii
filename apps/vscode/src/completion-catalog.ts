/**
 * A small cache in front of `@markii/host`'s `buildComponentCatalog`
 * (GitHub issue #27, slice 2), so the completion/hover providers in
 * `extension.ts` do not re-discover packs from disk on every keystroke.
 * `vscode`-free: the pack-discovery step is injected as `load`, exactly
 * how `insertComponentCommand` already calls `discoverConfiguredPacks`
 * itself, so this module stays unit-testable with no filesystem.
 */
import { buildComponentCatalog } from '@markii/host';
import type { DiscoveredPack, InsertableComponent } from '@markii/host';

export interface CatalogCache {
  /**
   * The cached catalog, building it via `load` on first use and again
   * after `invalidate()`. Never throws: a rejected `load` degrades to the
   * standard-set-only catalog (`buildComponentCatalog([])`), matching how
   * `insertComponentCommand` already swallows a pack-discovery failure
   * rather than failing the whole command.
   */
  get(): Promise<readonly InsertableComponent[]>;
  /** Drops the cached catalog (and any in-flight build), so the next `get()` rebuilds from `load`. */
  invalidate(): void;
}

/**
 * Builds a `CatalogCache` around `load`. Concurrent `get()` calls made
 * before a build finishes share one in-flight promise rather than each
 * starting their own pack discovery: a completion provider can be invoked
 * several times in quick succession as the user types.
 */
export function createCatalogCache(
  load: () => Promise<readonly DiscoveredPack[]>,
): CatalogCache {
  let cached: readonly InsertableComponent[] | undefined;
  let pending: Promise<readonly InsertableComponent[]> | undefined;

  async function build(): Promise<readonly InsertableComponent[]> {
    try {
      const packs = await load();
      return buildComponentCatalog(packs);
    } catch {
      return buildComponentCatalog([]);
    }
  }

  return {
    async get(): Promise<readonly InsertableComponent[]> {
      if (cached !== undefined) return cached;
      if (pending === undefined) {
        pending = build().then((catalog) => {
          cached = catalog;
          pending = undefined;
          return catalog;
        });
      }
      return pending;
    },
    invalidate(): void {
      cached = undefined;
      pending = undefined;
    },
  };
}
