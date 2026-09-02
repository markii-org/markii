/**
 * Composes every pack-loading piece (`@markii/host`'s `discoverPacks`,
 * `loadPackModules`, `resolvePrebuiltPack`, `buildRenderRegistry`,
 * `./pack-runtime.ts`) into the one thing `../main.ts` needs: everything
 * about the currently loadable, installed packs, loaded once and shared by
 * every view (the preview pane, Reading view, export, Insert Component,
 * completion) rather than each reloading its own copy.
 *
 * ARCHIVE-ONLY, NO COMPILER (AGENTS.md's Host positioning: Obsidian is a
 * consuming host, prebuilt archives are its only path). A pack folder
 * loads only when it already carries a prebuilt `webview.js` sibling to
 * its `pack.json` (`@markii/host`'s `resolvePrebuiltPack`) — there is no
 * compile step here at all, unlike VS Code, which also live-compiles
 * source packs. A folder with no prebuilt script is skipped with a plain
 * reason, never an attempt to build it.
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
 * trust list, resolving the plugin's install directory, injecting the
 * pack stylesheets into `document.head`) stays in `../main.ts`; this
 * module only takes already-resolved, absolute pack folders and a base
 * `Registry`, all as plain values.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { readFile as nodeReadFile } from 'node:fs/promises';
import type { Registry } from '@markii/react';
import {
  buildRenderRegistry,
  createNodeFileReader,
  discoverPacks,
  installedNamespaces,
  loadPackModules,
  resolvePrebuiltPack,
} from '@markii/host';
import type {
  DiscoveredPack,
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
  /** Folders that produced no usable pack, and why (developer-facing only): no `pack.json`, a manifest that failed validation, no prebuilt `webview.js`, or a script that threw while running. Still counts toward `packs`/`packModules` when the pack was at least discovered — just not toward `registry`. */
  readonly skipped: readonly SkippedPackFolder[];
  /** One line per malformed pack registration, dropped rather than installed (`@markii/host`'s `buildRenderRegistry`). */
  readonly invalidRegistrationReasons: readonly string[];
  /** Namespaces shared by two or more registered packs — when non-empty, `registry` fell back to `defaultRegistry` alone (docs/packs.md's install-time all-or-nothing rejection rule). */
  readonly registrationCollisions: readonly string[];
  /** Composed directive names two DIFFERENTLY named packs both claimed (`@markii/host`'s `DuplicateComposedName`) — the first pack keeps the name, the later pack's component is skipped. Expected to stay empty under ordinary pack composition; kept as a defense-in-depth invariant. */
  readonly duplicateComposedNames: readonly {
    readonly composedName: string;
    readonly keptPack: string;
    readonly skippedPack: string;
  }[];
  /**
   * Packs that ship BOTH a prebuilt `webview.js` and component sources on
   * disk (`@markii/host`'s `resolvePrebuiltPack`). Informational only: the
   * prebuilt script is what actually loads, and any sources next to it are
   * never read. Every pack this host installs (`./install-pack.ts`) writes
   * only `pack.json`/`webview.js`/`webview.css`/`scripts/*`, so this is
   * expected to stay empty for a pack that arrived through this plugin's
   * own install command; it stays a defense-in-depth check for a folder a
   * user placed by hand.
   */
  readonly prebuiltShadowedPacks: readonly {
    readonly name: string;
    readonly folder: string;
  }[];
}

/** Reads one file's UTF-8 text, or `undefined` if unreadable — reused for both a pack's compiled script and its sibling stylesheet. */
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

export interface LoadPackContextOptions {
  /** Reads a pack's compiled script's or stylesheet's text. Defaults to real `node:fs`. Injected for testability. */
  readonly readArtifact?: PackArtifactReader;
  /** Whether an absolute path exists on disk — used to detect a prebuilt `webview.js`/`webview.css` (`@markii/host`'s `resolvePrebuiltPack`). Defaults to real `node:fs`'s `existsSync`. Injected so this module stays testable without disk. */
  readonly pathExists?: PackPathExists;
  /**
   * The three bundled packs (docs/packs.md's "Bundled packs" section),
   * already decoded from `./bundled-packs-embedded.ts`'s base64 payload.
   * Defaults to `[]` — every existing caller and test that never passed
   * this keeps working unchanged, seeing no bundled packs (exactly what a
   * dev/Vitest run's empty placeholder embed already decodes to).
   * `../main.ts` passes `bundledPackAssets()`.
   *
   * Registered BEFORE any installed pack (docs/packs.md): evaluated first,
   * so their entries land first in the registration queue
   * `buildRenderRegistry` folds left-to-right, and any installed pack
   * whose namespace a bundled pack already claims is dropped from
   * discovery before it is ever evaluated, with a line recorded in
   * `skipped` — the bundled pack wins the namespace outright rather than
   * the two rejecting each other the way two colliding installed packs
   * would. `./install-pack.ts` also refuses this collision up front, at
   * install time, so it should only ever be reached here for a folder a
   * user placed by hand outside the install command.
   */
  readonly bundledPacks?: readonly BundledPackAsset[];
}

/** One resolved pack's script text plus, if it has one, its stylesheet text — read once so evaluation and stylesheet collection do not each hit disk separately. */
interface ResolvedPack {
  readonly pack: DiscoveredPack;
  readonly scriptText: string;
  readonly cssText: string | undefined;
}

interface ResolveInstalledPacksResult {
  readonly resolved: readonly ResolvedPack[];
}

/**
 * Resolves the prebuilt script (and stylesheet, if any) for every
 * discovered, installed pack. A pack with no prebuilt `webview.js` is
 * recorded in `skipped` (mutated in place) and excluded from the returned
 * list — never a compile attempt. A pack whose prebuilt script shadows
 * component sources still present on disk is recorded in
 * `prebuiltShadowedPacks` (mutated in place) — informational only, never a
 * failure.
 */
async function resolveInstalledPacks(
  packs: readonly DiscoveredPack[],
  skipped: SkippedPackFolder[],
  prebuiltShadowedPacks: { readonly name: string; readonly folder: string }[],
  readArtifact: PackArtifactReader,
  pathExists: PackPathExists,
): Promise<ResolveInstalledPacksResult> {
  const resolved: ResolvedPack[] = [];

  for (const pack of packs) {
    const prebuilt = await resolvePrebuiltPack(pack, pathExists);
    if (!prebuilt) {
      skipped.push({
        folder: pack.folder,
        reason: `pack "${pack.manifest.name}" has no prebuilt webview.js and cannot be compiled on this host`,
      });
      continue;
    }
    if (prebuilt.shadowedComponentSources.length > 0) {
      prebuiltShadowedPacks.push({
        name: pack.manifest.name,
        folder: pack.folder,
      });
    }

    const scriptText = await readArtifact(prebuilt.scriptPath);
    if (scriptText === undefined) {
      skipped.push({
        folder: pack.folder,
        reason: `pack "${pack.manifest.name}" registration script "${prebuilt.scriptPath}" could not be read`,
      });
      continue;
    }

    const cssText =
      prebuilt.stylesheetPath !== undefined
        ? await readArtifact(prebuilt.stylesheetPath)
        : undefined;

    resolved.push({
      pack: {
        ...pack,
        scriptPath: prebuilt.scriptPath,
        ...(prebuilt.stylesheetPath !== undefined
          ? { stylesheetPath: prebuilt.stylesheetPath }
          : {}),
      },
      scriptText,
      cssText,
    });
  }

  return { resolved };
}

/**
 * Loads everything about the packs found under `installedFolders` (already
 * resolved, absolute, trusted-on-this-device folders — `../main.ts`'s
 * `selectLoadablePackFolders`). Never throws: every step it composes
 * already degrades quietly.
 */
export async function loadPackContext(
  installedFolders: readonly string[],
  defaultRegistry: Registry,
  options: LoadPackContextOptions = {},
): Promise<PackContext> {
  const {
    readArtifact = defaultArtifactReader,
    pathExists = existsSync,
    bundledPacks: bundledAssets = [],
  } = options;

  // Bundled packs (docs/packs.md's "Bundled packs" section) resolve first,
  // and never touch disk — they arrive already compiled, embedded into
  // `main.js` at build time. `skipped` starts from whatever
  // `resolveBundledPacks` itself rejected (a malformed embed, or two
  // bundled assets sharing a namespace — should never happen from this
  // repo's own build, but validated rather than trusted).
  const { resolved: bundledResolved, invalid: bundledInvalid } =
    resolveBundledPacks(bundledAssets);
  const bundledNamespaces = new Set(
    bundledResolved.map((entry) => entry.pack.manifest.name),
  );
  const skipped: SkippedPackFolder[] = [...bundledInvalid];

  const discovery = await discoverPacks(
    installedFolders,
    createNodeFileReader(),
  );
  skipped.push(...discovery.skipped);

  // An installed pack claiming a namespace a bundled pack already holds is
  // skipped outright, before it is ever evaluated — the bundled pack wins
  // the namespace (docs/packs.md: "This follows the ordinary collision
  // rule above rather than making an exception to it"). Filtering here,
  // rather than letting both flow into the shared registration queue,
  // matters because `buildRenderRegistry`'s own namespace-collision rule
  // rejects BOTH claimants and falls back to `defaultRegistry` alone —
  // which would also cost the bundled pack its slot, the opposite of
  // "bundled wins". `./install-pack.ts` refuses this at install time, so
  // it should only be reached here for a hand-placed folder.
  const installedPacks: DiscoveredPack[] = [];
  for (const pack of discovery.packs) {
    // An installed pack's folder is named by its namespace: that is what
    // `./install-pack.ts` writes, and it is what the trust list
    // (`./pack-trust.ts`) authorizes, so the settings tab can offer
    // Remove for a name and have it delete the right folder. A folder
    // whose `pack.json` declares some other namespace can only come from
    // a hand copy or a hand edit, and loading it would mean running code
    // under a name this device never enabled, so it is skipped and said
    // so.
    if (path.basename(pack.folder) !== pack.manifest.name) {
      skipped.push({
        folder: pack.folder,
        reason: `pack folder "${pack.folder}" declares namespace "${pack.manifest.name}" and was not loaded: an installed pack folder is named by its namespace`,
      });
      continue;
    }
    if (bundledNamespaces.has(pack.manifest.name)) {
      skipped.push({
        folder: pack.folder,
        reason: `pack namespace "${pack.manifest.name}" is already used by a bundled pack and was not loaded`,
      });
      continue;
    }
    installedPacks.push(pack);
  }

  const installedPackModules = await loadPackModules(installedPacks);
  const packModules: PackModulesMap = {
    ...Object.fromEntries(
      bundledResolved.map((entry) => [
        entry.pack.manifest.name,
        entry.luaModules,
      ]),
    ),
    ...installedPackModules,
  };

  const prebuiltShadowedPacks: {
    readonly name: string;
    readonly folder: string;
  }[] = [];
  const { resolved: resolvedInstalledPacks } = await resolveInstalledPacks(
    installedPacks,
    skipped,
    prebuiltShadowedPacks,
    readArtifact,
    pathExists,
  );

  installPackRuntime();
  const evalFailureNames = new Set<string>();
  // Bundled packs evaluate FIRST, so their registrations land first in the
  // queue `buildRenderRegistry` folds left-to-right (docs/packs.md: "They
  // are registered before any installed pack").
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
  for (const { pack, scriptText } of resolvedInstalledPacks) {
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
    ...resolvedInstalledPacks
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
    ...installedPacks,
  ];

  return {
    packs,
    packModules,
    registry,
    stylesheets,
    namespaces: installedNamespaces(packs),
    skipped,
    invalidRegistrationReasons: invalidReasons,
    registrationCollisions: collisions,
    duplicateComposedNames,
    prebuiltShadowedPacks,
  };
}
