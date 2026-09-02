/**
 * Composes every pack-loading piece (`@markii/host`'s `discoverPacks`,
 * `loadPackModules`, `resolvePackPaths`, `buildRenderRegistry`,
 * `packs/pack-build.ts`, `./pack-runtime.ts`) into the one thing
 * `view.tsx` needs: everything about the currently configured, installed
 * packs, loaded once per preview open (docs/packs.md: "reloading a pack
 * requires reopening the preview" — see `../settings-tab.ts`'s note to that
 * effect).
 *
 * The pack-loading pieces this composes are shared, host-neutral logic
 * hoisted into `@markii/host` (used the same way by
 * `apps/vscode/src/packs/pack-context.ts`). The real difference from the
 * VS Code version: that one only builds a webview registration artifact
 * and hands its URI to a webview to load itself; this one goes one step
 * further and actually EVALUATES the compiled script in-process
 * (`./pack-runtime.ts`) and folds the result into a `Registry`
 * (`@markii/host`'s `buildRenderRegistry`), since there is no separate
 * webview process to do that on this host.
 *
 * `obsidian`-free — every Obsidian-specific step (reading the device-local
 * pack-folder setting, resolving the vault base path, injecting the pack
 * stylesheets into `document.head`) stays in `../view.tsx`/`../main.ts`;
 * this module only takes the already-read setting value, the vault root,
 * and a base `Registry`, all as plain values.
 */
import { existsSync } from 'node:fs';
import { readFile as nodeReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { Registry } from '@markii/react';
import {
  buildRenderRegistry,
  createNodeFileReader,
  discoverPacks,
  installedNamespaces,
  loadPackModules,
  relativePackEntries,
  resolvePackPaths,
  resolvePrebuiltPack,
} from '@markii/host';
import type {
  DiscoveredPack,
  PackBuildOutcome,
  PackModulesMap,
  PackPathExists,
  SkippedPackFolder,
} from '@markii/host';
import {
  collectPackRegistrations,
  evaluatePackScript,
  installPackRuntime,
} from './pack-runtime.js';
import { resolveBundledPacks } from './bundled-packs.js';
import type { BundledPackAsset } from './bundled-packs.js';
import {
  createNodePackBytesReader,
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacks,
} from './archive-packs.js';
import type { PackBytesReader, ResolvedArchivePack } from './archive-packs.js';

/** One pack stylesheet ready to inject (`../packs/pack-styles.ts`), keyed by the pack's namespace so it can be removed again by the same key. */
export interface PackStylesheet {
  readonly namespace: string;
  readonly cssText: string;
}

export interface PackContext {
  /** Every validated, non-colliding discovered pack. */
  readonly packs: readonly DiscoveredPack[];
  /** Pre-read `scripts/*.lua` source for every discovered pack, for the Run path's `PackModuleResolver` (`@markii/host`'s `run/lua-resolver.ts`). */
  readonly packModules: PackModulesMap;
  /** `defaultRegistry` merged with every pack whose compiled script evaluated and registered cleanly. Falls back to `defaultRegistry` alone on a namespace collision (`registrationCollisions` then explains why) or when no pack produced a usable registration. */
  readonly registry: Registry;
  /** Every registered pack's emitted stylesheet, ready for `../packs/pack-styles.ts` to inject after `styles.css`. */
  readonly stylesheets: readonly PackStylesheet[];
  /** Every discovered pack's namespace — what `resolveUses` (`@markii/pack`) checks a note's `uses:` declaration against. */
  readonly namespaces: readonly string[];
  /** Configured folders that produced no usable pack, and why (developer-facing only). Also carries a build-failure or script-evaluation-failure reason for a pack whose compiled script never registered — it still counts toward `packs`/`packModules`, just not `registry`. */
  readonly skipped: readonly SkippedPackFolder[];
  /** Pack-folder setting entries that are relative (`./pack-paths.ts`'s `relativePackEntries`) — an informational diagnostics note, never a behavior change. */
  readonly relativeEntries: readonly string[];
  /** Pack CSS authoring warnings (`@markii/host`'s `packs/pack-css-lint.ts`) against every built pack's emitted stylesheet. Warnings only, developer-facing. */
  readonly cssWarnings: readonly string[];
  /** One line per malformed pack registration, dropped rather than installed (`./pack-render-registry.ts`). */
  readonly invalidRegistrationReasons: readonly string[];
  /** Namespaces shared by two or more registered packs — when non-empty, `registry` fell back to `defaultRegistry` alone (docs/packs.md's install-time all-or-nothing rejection rule). */
  readonly registrationCollisions: readonly string[];
  /** Composed directive names two DIFFERENTLY named packs both claimed (`./pack-render-registry.ts`'s `DuplicateComposedName`) — the first pack keeps the name, the later pack's component is skipped. Expected to stay empty under ordinary pack composition; kept as a defense-in-depth invariant. */
  readonly duplicateComposedNames: readonly {
    readonly composedName: string;
    readonly keptPack: string;
    readonly skippedPack: string;
  }[];
  /**
   * Packs that ship BOTH a prebuilt `webview.js` and component sources on
   * disk (`@markii/host`'s `resolvePrebuiltPack`, issue #15). Informational
   * only: the prebuilt script is what actually loads, and the sources next
   * to it are never compiled or read. This is a supported distribution
   * shape (a pack author who ships the built artifact alongside its
   * sources for reference), never a failure — it contributes nothing to
   * `skipped` and nothing to `../view.tsx`'s `notifyPackFailures`.
   */
  readonly prebuiltShadowedPacks: readonly {
    readonly name: string;
    readonly folder: string;
  }[];
}

/** Reads one file's UTF-8 text, or `undefined` if unreadable — reused for both a compiled script and its sibling stylesheet. */
export type PackArtifactReader = (
  absolutePath: string,
) => Promise<string | undefined>;

const defaultArtifactReader: PackArtifactReader = async (absolutePath) => {
  try {
    return await nodeReadFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

/** Builds one pack's compiled registration script from source — injected so this module stays testable without a real esbuild-wasm invocation, and so `view.tsx`/`main.ts` can wire up the real `@markii/host`'s `buildPackRegistrationScript` with the plugin's own esbuild-wasm asset paths. */
export type PackCompileBuilder = (
  pack: DiscoveredPack,
  cacheDir: string,
) => Promise<PackBuildOutcome>;

/** The default: never attempts a build. A pack with no prebuilt `webview.js` is simply excluded from the render registry, with nothing added to `skipped` (a `'skipped'` outcome is not a failure). */
const noopBuilder: PackCompileBuilder = async () => ({ kind: 'skipped' });

export interface LoadPackContextOptions {
  /** An plugin-owned directory a compiled registration script may be cached under (never a pack's own folder — AGENTS.md's cleanliness rule). Required for `buildRegistrationScript` to ever be called at all. */
  readonly cacheDir?: string;
  /** Defaults to `noopBuilder`. `../view.tsx` passes `@markii/host`'s `buildPackRegistrationScript`, wired to the plugin's copied `esbuild-wasm` assets. */
  readonly buildRegistrationScript?: PackCompileBuilder;
  /** Reads a compiled script's or stylesheet's text. Defaults to real `node:fs`. Injected for testability. */
  readonly readArtifact?: PackArtifactReader;
  /** Whether an absolute path exists on disk — used to detect a prebuilt `webview.js`/`webview.css` (`@markii/host`'s `resolvePrebuiltPack`). Defaults to real `node:fs`'s `existsSync`. Injected so this module stays testable without disk, matching `readArtifact`/`buildRegistrationScript` above. */
  readonly pathExists?: PackPathExists;
  /**
   * The three bundled packs (docs/packs.md's "Bundled packs" section,
   * issue #15), already decoded from `./bundled-packs-embedded.ts`'s
   * base64 payload. Defaults to `[]` — every existing caller and test that
   * never passed this keeps working unchanged, seeing no bundled packs
   * (exactly what a dev/Vitest run's empty placeholder embed already
   * decodes to). `../view.tsx`/`../main.ts` pass `bundledPackAssets()`.
   *
   * Registered BEFORE any user-configured pack (docs/packs.md): evaluated
   * first, so their entries land first in the registration queue
   * `buildRenderRegistry` folds left-to-right, and any user pack whose
   * namespace a bundled pack already claims is dropped from discovery
   * before it is ever compiled or evaluated, with a line recorded in
   * `skipped` — the bundled pack wins the namespace outright rather than
   * the two rejecting each other the way two colliding user packs would.
   */
  readonly bundledPacks?: readonly BundledPackAsset[];
  /**
   * Reads a `.mkp` archive's raw bytes (`./archive-packs.ts`'s
   * `PackBytesReader`), for a configured pack-folder-list entry that names
   * a `.mkp` FILE directly rather than a folder (GitHub issue #16). Defaults
   * to real `node:fs`. Injected for testability, matching `readArtifact`/
   * `pathExists` above.
   */
  readonly readArchiveBytes?: PackBytesReader;
}

/** One compiled pack's script text plus, if it has one, its stylesheet text — read once so evaluation and stylesheet collection do not each hit disk separately. */
interface CompiledPack {
  readonly pack: DiscoveredPack;
  readonly scriptText: string;
  readonly cssText: string | undefined;
}

/**
 * Resolves the usable compiled script (and stylesheet, if any) for every
 * discovered pack: a prebuilt `webview.js` sibling to `pack.json` if one
 * exists (`@markii/host`'s `resolvePrebuiltPack`, whose optional sibling
 * `webview.css` becomes this pack's `stylesheetPath` when present),
 * otherwise a build via `buildRegistrationScript` when `cacheDir` is
 * configured. A pack that fails either step is recorded in `skipped`
 * (mutated in place) and excluded from the returned list — never thrown. A
 * pack whose prebuilt script shadows component sources still present on
 * disk is recorded in `prebuiltShadowedPacks` (mutated in place) —
 * informational only, never a failure.
 */
interface ResolveCompiledPacksResult {
  readonly compiled: readonly CompiledPack[];
  readonly cssWarnings: readonly string[];
}

async function resolveCompiledPacks(
  packs: readonly DiscoveredPack[],
  skipped: SkippedPackFolder[],
  prebuiltShadowedPacks: { readonly name: string; readonly folder: string }[],
  cacheDir: string | undefined,
  buildRegistrationScript: PackCompileBuilder,
  readArtifact: PackArtifactReader,
  pathExists: PackPathExists,
): Promise<ResolveCompiledPacksResult> {
  const compiled: CompiledPack[] = [];
  const cssWarnings: string[] = [];

  for (const pack of packs) {
    let scriptPath = pack.scriptPath;
    let stylesheetPath = pack.stylesheetPath;
    let warnings: readonly string[] = [];

    const prebuilt = await resolvePrebuiltPack(pack, pathExists);
    if (prebuilt) {
      scriptPath = prebuilt.scriptPath;
      stylesheetPath = prebuilt.stylesheetPath;
      if (prebuilt.shadowedComponentSources.length > 0) {
        prebuiltShadowedPacks.push({
          name: pack.manifest.name,
          folder: pack.folder,
        });
      }
    } else {
      if (cacheDir === undefined) continue;
      const outcome = await buildRegistrationScript(pack, cacheDir);
      if (outcome.kind === 'built') {
        scriptPath = outcome.scriptPath;
        stylesheetPath = outcome.stylesheetPath;
        warnings = outcome.warnings;
      } else if (outcome.kind === 'failed') {
        skipped.push({
          folder: pack.folder,
          reason: `pack "${pack.manifest.name}" registration script build failed (${outcome.reason})`,
        });
        continue;
      } else {
        continue;
      }
    }

    const scriptText = await readArtifact(scriptPath);
    if (scriptText === undefined) {
      skipped.push({
        folder: pack.folder,
        reason: `pack "${pack.manifest.name}" registration script "${scriptPath}" could not be read`,
      });
      continue;
    }

    const cssText =
      stylesheetPath !== undefined
        ? await readArtifact(stylesheetPath)
        : undefined;

    compiled.push({
      pack: { ...pack, scriptPath, stylesheetPath },
      scriptText,
      cssText,
    });
    if (warnings.length > 0) {
      cssWarnings.push(...warnings);
    }
  }

  return { compiled, cssWarnings };
}

/**
 * Loads everything about the packs named by `configuredFolders` (this
 * plugin's device-local pack-folder setting, unresolved) resolved against
 * `vaultRoot`. Never throws: every step it composes already degrades
 * quietly.
 */
export async function loadPackContext(
  configuredFolders: readonly string[],
  vaultRoot: string | undefined,
  defaultRegistry: Registry,
  options: LoadPackContextOptions = {},
): Promise<PackContext> {
  const {
    cacheDir,
    buildRegistrationScript = noopBuilder,
    readArtifact = defaultArtifactReader,
    pathExists = existsSync,
    bundledPacks: bundledAssets = [],
    readArchiveBytes = createNodePackBytesReader(),
  } = options;
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredFolders, vaultRoot, homeDir);
  const relativeEntries = relativePackEntries(configuredFolders, homeDir);
  // A configured entry may name a `.mkp` FILE directly rather than a folder
  // (docs/packs.md's "A pack as a single file", GitHub issue #16): it loads
  // read-only from the archive, prebuilt form only, and is never compiled.
  const { folderPaths, archivePaths } = partitionConfiguredPackPaths(folders);

  // Bundled packs (docs/packs.md's "Bundled packs" section) resolve first,
  // and never touch disk or the esbuild-wasm builder — they arrive already
  // compiled, embedded into `main.js` at build time. `skipped` starts from
  // whatever `resolveBundledPacks` itself rejected (a malformed embed, or
  // two bundled assets sharing a namespace — should never happen from this
  // repo's own build, but validated rather than trusted).
  const { resolved: bundledResolved, invalid: bundledInvalid } =
    resolveBundledPacks(bundledAssets);
  const bundledNamespaces = new Set(
    bundledResolved.map((entry) => entry.pack.manifest.name),
  );
  const skipped: SkippedPackFolder[] = [...bundledInvalid];

  const discovery = await discoverPacks(folderPaths, createNodeFileReader());
  skipped.push(...discovery.skipped);

  // `.mkp` archives (docs/packs.md's "A pack as a single file"): resolved
  // entirely in memory, never compiled — see `./archive-packs.ts`'s top
  // doc comment for why this plugin needs no on-disk extraction for the
  // preview path, unlike `apps/vscode`'s equivalent.
  const { resolved: archiveResolved, skipped: archiveSkipped } =
    await resolveArchivePacks(archivePaths, readArchiveBytes);
  skipped.push(...archiveSkipped);
  const archiveResolvedByFolder = new Map<string, ResolvedArchivePack>(
    archiveResolved.map((entry) => [entry.pack.folder, entry]),
  );

  // Folder discovery and archive resolution each check for collisions only
  // WITHIN their own source, so a namespace shared BETWEEN the two would
  // otherwise go undetected — `mergeArchiveAndFolderPacks` applies the same
  // "both claimants dropped" rule across the combined set.
  const merged = mergeArchiveAndFolderPacks(
    discovery.packs,
    archiveResolved.map((entry) => entry.pack),
  );
  skipped.push(...merged.skipped);

  // A user-configured pack claiming a namespace a bundled pack already
  // holds is skipped outright, before it is ever compiled or evaluated —
  // the bundled pack wins the namespace (docs/packs.md: "This follows the
  // ordinary collision rule above rather than making an exception to it").
  // Filtering here, rather than letting both flow into the shared
  // registration queue, matters because `buildRenderRegistry`'s own
  // namespace-collision rule rejects BOTH claimants and falls back to
  // `defaultRegistry` alone — which would also cost the bundled pack its
  // slot, the opposite of "bundled wins".
  const userPacks: DiscoveredPack[] = [];
  for (const pack of merged.packs) {
    if (bundledNamespaces.has(pack.manifest.name)) {
      skipped.push({
        folder: pack.folder,
        reason: `pack namespace "${pack.manifest.name}" is already used by a bundled pack and was not installed`,
      });
      continue;
    }
    userPacks.push(pack);
  }

  // Archive packs never need `loadPackModules`'s directory read (their Lua
  // modules were already decoded from the archive in memory) or
  // `resolveCompiledPacks`'s prebuilt/build resolution (their script and
  // stylesheet text are already decoded too) — only the folder-discovered
  // packs go through either step.
  const folderUserPacks = userPacks.filter(
    (pack) => !archiveResolvedByFolder.has(pack.folder),
  );
  const archiveUserPacks = userPacks.filter((pack) =>
    archiveResolvedByFolder.has(pack.folder),
  );

  const userPackModules = await loadPackModules(folderUserPacks);
  const packModules: PackModulesMap = {
    ...Object.fromEntries(
      bundledResolved.map((entry) => [
        entry.pack.manifest.name,
        entry.luaModules,
      ]),
    ),
    ...Object.fromEntries(
      archiveUserPacks.map((pack) => [
        pack.manifest.name,
        archiveResolvedByFolder.get(pack.folder)!.luaModules,
      ]),
    ),
    ...userPackModules,
  };

  const prebuiltShadowedPacks: {
    readonly name: string;
    readonly folder: string;
  }[] = [];
  const { compiled: folderCompiledPacks, cssWarnings } =
    await resolveCompiledPacks(
      folderUserPacks,
      skipped,
      prebuiltShadowedPacks,
      cacheDir,
      buildRegistrationScript,
      readArtifact,
      pathExists,
    );
  const compiledPacks: CompiledPack[] = [
    ...archiveUserPacks.map((pack) => {
      const archived = archiveResolvedByFolder.get(pack.folder)!;
      return {
        pack,
        scriptText: archived.scriptText,
        cssText: archived.cssText,
      };
    }),
    ...folderCompiledPacks,
  ];

  installPackRuntime();
  const evalFailureNames = new Set<string>();
  // Bundled packs evaluate FIRST, so their registrations land first in the
  // queue `buildRenderRegistry` folds left-to-right (docs/packs.md: "They
  // are registered before any pack a user configured").
  for (const { pack, scriptText } of bundledResolved) {
    const result = evaluatePackScript(scriptText);
    if (!result.ok) {
      skipped.push({
        folder: pack.folder,
        reason: `bundled pack "${pack.manifest.name}" registration script failed to run (${result.reason})`,
      });
      evalFailureNames.add(pack.manifest.name);
    }
  }
  for (const { pack, scriptText } of compiledPacks) {
    const result = evaluatePackScript(scriptText);
    if (!result.ok) {
      skipped.push({
        folder: pack.folder,
        reason: `pack "${pack.manifest.name}" registration script failed to run (${result.reason})`,
      });
      evalFailureNames.add(pack.manifest.name);
    }
  }
  const registrations = collectPackRegistrations();

  const stylesheets: PackStylesheet[] = [
    ...bundledResolved
      .filter(
        (entry) =>
          entry.cssText !== undefined &&
          !evalFailureNames.has(entry.pack.manifest.name),
      )
      .map((entry) => ({
        namespace: entry.pack.manifest.name,
        cssText: entry.cssText!,
      })),
    ...compiledPacks
      .filter(
        (entry) =>
          entry.cssText !== undefined &&
          !evalFailureNames.has(entry.pack.manifest.name),
      )
      .map((entry) => ({
        namespace: entry.pack.manifest.name,
        cssText: entry.cssText!,
      })),
  ];

  const { registry, invalidReasons, collisions, duplicateComposedNames } =
    buildRenderRegistry(registrations, defaultRegistry);

  const packs: DiscoveredPack[] = [
    ...bundledResolved.map((entry) => entry.pack),
    ...userPacks,
  ];

  return {
    packs,
    packModules,
    registry,
    stylesheets,
    namespaces: installedNamespaces(packs),
    skipped,
    relativeEntries,
    cssWarnings,
    invalidRegistrationReasons: invalidReasons,
    registrationCollisions: collisions,
    duplicateComposedNames,
    prebuiltShadowedPacks,
  };
}
