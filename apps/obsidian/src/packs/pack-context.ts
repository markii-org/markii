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
} from '@markii/host';
import type {
  DiscoveredPack,
  PackBuildOutcome,
  PackModulesMap,
  SkippedPackFolder,
} from '@markii/host';
import {
  collectPackRegistrations,
  evaluatePackScript,
  installPackRuntime,
} from './pack-runtime.js';

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
  /** Pack-folder setting entries that are relative (`./pack-paths.ts`'s `relativePackEntries`) — a deprecation warning, never a behavior change. */
  readonly deprecatedRelativeEntries: readonly string[];
  /** Pack CSS authoring warnings (`@markii/host`'s `packs/pack-css-lint.ts`) against every built pack's emitted stylesheet. Warnings only, developer-facing. */
  readonly cssWarnings: readonly string[];
  /** One line per malformed pack registration, dropped rather than installed (`./pack-render-registry.ts`). */
  readonly invalidRegistrationReasons: readonly string[];
  /** Namespaces shared by two or more registered packs — when non-empty, `registry` fell back to `defaultRegistry` alone (`installPacks`'s all-or-nothing rule). */
  readonly registrationCollisions: readonly string[];
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
 * exists, otherwise a build via `buildRegistrationScript` when `cacheDir`
 * is configured. A pack that fails either step is recorded in `skipped`
 * (mutated in place) and excluded from the returned list — never thrown.
 */
interface ResolveCompiledPacksResult {
  readonly compiled: readonly CompiledPack[];
  readonly cssWarnings: readonly string[];
}

async function resolveCompiledPacks(
  packs: readonly DiscoveredPack[],
  skipped: SkippedPackFolder[],
  cacheDir: string | undefined,
  buildRegistrationScript: PackCompileBuilder,
  readArtifact: PackArtifactReader,
): Promise<ResolveCompiledPacksResult> {
  const compiled: CompiledPack[] = [];
  const cssWarnings: string[] = [];

  for (const pack of packs) {
    let scriptPath = pack.scriptPath;
    let stylesheetPath = pack.stylesheetPath;
    let warnings: readonly string[] = [];

    if (!existsSync(scriptPath)) {
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
  } = options;
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredFolders, vaultRoot, homeDir);
  const deprecatedRelativeEntries = relativePackEntries(
    configuredFolders,
    homeDir,
  );

  const discovery = await discoverPacks(folders, createNodeFileReader());
  const packModules = await loadPackModules(discovery.packs);

  const skipped: SkippedPackFolder[] = [...discovery.skipped];
  const { compiled: compiledPacks, cssWarnings } = await resolveCompiledPacks(
    discovery.packs,
    skipped,
    cacheDir,
    buildRegistrationScript,
    readArtifact,
  );

  installPackRuntime();
  const evalFailureNames = new Set<string>();
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

  const stylesheets: PackStylesheet[] = compiledPacks
    .filter(
      (entry) =>
        entry.cssText !== undefined &&
        !evalFailureNames.has(entry.pack.manifest.name),
    )
    .map((entry) => ({
      namespace: entry.pack.manifest.name,
      cssText: entry.cssText!,
    }));

  const { registry, invalidReasons, collisions } = buildRenderRegistry(
    registrations,
    defaultRegistry,
  );

  return {
    packs: discovery.packs,
    packModules,
    registry,
    stylesheets,
    namespaces: installedNamespaces(discovery.packs),
    skipped,
    deprecatedRelativeEntries,
    cssWarnings,
    invalidRegistrationReasons: invalidReasons,
    registrationCollisions: collisions,
  };
}
