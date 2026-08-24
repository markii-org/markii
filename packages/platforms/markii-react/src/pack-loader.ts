import type { PackManifest } from '@markii/pack';
import { composeDirectiveName, detectNamespaceCollisions } from '@markii/pack';
import type { Registry, RegistryEntry } from './registry.js';
import { createRegistry, mergeRegistries } from './registry.js';

/**
 * This renderer's engine id (docs/packs.md's `engine` field on
 * `pack.json`). A pack whose manifest names a different engine cannot run
 * its components here — see `loadPack`.
 */
export const REACT_ENGINE_ID = 'react';

/**
 * The component modules a host hands to `loadPack`, keyed by the
 * manifest's LOCAL component name (not the namespaced directive name).
 * `@markii/pack`'s `PackManifest.components` only carries a pack-relative
 * SOURCE PATH per docs/packs.md ("A pack is an npm-ish folder: a manifest
 * plus component sources") — resolving that path to an actual module is a
 * host concern (bundling, `import()`, whatever), out of scope for this
 * slice. The host does that resolution and passes the already-imported
 * modules here.
 */
export type PackComponentModules = Record<string, RegistryEntry>;

/**
 * Loads one pack's components into a `Registry`, namespaced under the
 * pack's name via `composeDirectiveName` (docs/packs.md: an author opts in
 * to a pack component by typing the prefixed name, e.g. `:::ana-timeline`).
 *
 * Engine gating: `manifest.engine` names the renderer framework the pack's
 * components are WRITTEN for (docs/packs.md). If it is not `"react"`
 * (`REACT_ENGINE_ID`), this renderer cannot run the pack's components at
 * all, so `loadPack` returns an EMPTY registry rather than registering
 * anything. That is deliberate: with nothing registered under the pack's
 * namespace, a note's `:::ana-timeline` falls through to `@markii/react`'s
 * existing unknown-component fallback (dashed box, inner markdown still
 * shown) instead of throwing or silently running the wrong framework's
 * component. This never throws — an unsupported engine is exactly the
 * ordinary "pack not installed for this host" case, not an error.
 *
 * Missing/extra modules: for each `manifest.components` entry, this looks
 * up the matching module in `componentModules` by the LOCAL name. A
 * manifest entry with no matching module is simply skipped — its
 * namespaced directive name never enters the returned registry, so it too
 * falls back to the unknown-component box rather than throwing. This
 * never throws for a partially-satisfied `componentModules`, since a pack
 * update that adds a component before the host wires up its module should
 * degrade the SAME way an unsupported engine does, not break the page. A
 * `componentModules` entry with no matching manifest component (the
 * reverse mismatch — the host passed a stray module) is likewise ignored:
 * only manifest-declared components are ever iterated, so nothing is
 * registered under a name the pack itself never declared.
 *
 * Both `manifest.components` and `componentModules` are read with
 * `Object.hasOwn` only (never bare indexing or `for...in`), matching
 * `@markii/pack`'s own hostile-map discipline: a `componentModules` object
 * literal with a poisoned `__proto__`/`constructor` cannot leak an
 * inherited value in as a registered component. A manifest component name
 * that is itself prototype-shaped (`"constructor"`, etc.) has already been
 * rejected by `@markii/pack`'s `validateLocalComponentName` before a
 * `PackManifest` can exist, so this function does not re-validate that; it
 * only guards the *lookup*, not the manifest's own shape.
 */
export function loadPack(
  manifest: PackManifest,
  componentModules: PackComponentModules,
): Registry {
  if (manifest.engine !== REACT_ENGINE_ID) {
    return createRegistry();
  }

  const entries: Registry = {};

  for (const localName of Object.keys(manifest.components)) {
    if (!Object.hasOwn(manifest.components, localName)) continue;
    if (!Object.hasOwn(componentModules, localName)) continue;

    const module = componentModules[localName];
    if (module == null) continue;

    const composed = composeDirectiveName(manifest.name, localName);
    if (!composed.ok) continue;

    entries[composed.name] = module;
  }

  return createRegistry(entries);
}

/** One pack ready to install: its manifest plus its resolved component modules. */
export interface PackToInstall {
  manifest: PackManifest;
  componentModules: PackComponentModules;
}

/**
 * The result of `installPacks`: either every pack installed cleanly into a
 * merged `Registry`, or the install was rejected because two or more of the
 * given packs share a namespace.
 *
 * A result type rather than a thrown exception: which packs to install is
 * ordinarily host-controlled configuration data (not a programmer error at
 * the call site), so the host gets a value it can present to whoever is
 * configuring packs, matching `@markii/pack`'s own never-throw validation
 * style (`parsePackManifest`, `validatePackName`, ...) instead of forcing
 * every caller into a try/catch for what is really a validation outcome.
 */
export type InstallPacksResult =
  | { ok: true; registry: Registry }
  | { ok: false; collisions: readonly string[] };

/**
 * Installs several packs into one `Registry`, merged on top of `base`
 * (default: an empty registry).
 *
 * docs/packs.md, "Collision and install rules": "Installing two packs with
 * the same namespace is rejected at install time." This checks the
 * `packs` namespaces with `detectNamespaceCollisions` BEFORE loading or
 * merging anything; if any namespace repeats, nothing is installed and the
 * colliding namespaces are returned via `{ ok: false, collisions }` instead
 * of a partially-merged registry. `base`'s own directive names are not
 * part of this check — the collision rule is about two PACKS sharing a
 * namespace, not about a pack's namespaced name coincidentally matching an
 * unrelated entry already in `base` (ordinary `mergeRegistries` last-wins
 * semantics already cover that case, same as any other registry merge).
 *
 * Each pack that survives the collision check is loaded with `loadPack`
 * (so a non-react-engine pack among the set still contributes an empty
 * registry, never an error) and merged left-to-right with `mergeRegistries`,
 * `base` first.
 */
export function installPacks(
  packs: readonly PackToInstall[],
  base: Registry = createRegistry(),
): InstallPacksResult {
  const namespaces = packs.map((pack) => pack.manifest.name);
  const collisions = detectNamespaceCollisions(namespaces);
  if (collisions.length > 0) {
    return {
      ok: false,
      collisions: collisions.map((collision) => collision.namespace),
    };
  }

  const loaded = packs.map((pack) =>
    loadPack(pack.manifest, pack.componentModules),
  );
  return { ok: true, registry: mergeRegistries(base, ...loaded) };
}
