/**
 * Composes the pack-loading pieces (`@markii/host`'s `discoverPacks`,
 * `loadPackModules`, `resolvePackPaths`, `buildPackRegistrationScript`)
 * into the one thing `preview-panel.ts` needs: everything about the
 * currently configured, installed packs, loaded once per panel.
 * `vscode`-free — every `vscode`-specific step (reading the `markii.packs`
 * setting, resolving `asWebviewUri`) stays in `preview-panel.ts`; this
 * module only takes the already-read setting value, workspace root, and
 * (optionally) an extension-owned cache directory as plain strings.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import {
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
import { discoverBundledPacks, mergeBundledPacks } from './bundled-packs.js';
import {
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacksForPreview,
} from './archive-packs.js';

export interface PackContext {
  /** Every validated, non-colliding discovered pack. */
  readonly packs: readonly DiscoveredPack[];
  /** Pre-read `scripts/*.lua` source for every discovered pack, for the Run path's `PackModuleResolver` (`@markii/host`'s `run/lua-resolver.ts`). */
  readonly packModules: PackModulesMap;
  /**
   * The subset of `packs` that have a usable registration script — either a
   * prebuilt `webview.js` sitting next to `pack.json` (`@markii/host`'s
   * `discover.ts`'s `scriptPath` doc comment), or one `buildWebviewScript`
   * compiled from the pack's `.tsx` sources (`@markii/host`'s
   * `pack-build.ts`); in the built case, `scriptPath` is overridden to
   * point at the compiled output instead. What the webview's
   * `<script src=...>` tags load. A pack with neither still counts toward
   * `packs`/`packModules` (its Lua modules and namespace are real) but
   * contributes nothing to the webview UI.
   */
  readonly webviewPacks: readonly DiscoveredPack[];
  /** Every discovered pack's namespace — what `resolveUses` (`@markii/pack`) checks a note's `uses:` declaration against. */
  readonly namespaces: readonly string[];
  /** Configured folders that produced no usable pack, and why (developer-facing only). Also carries a build-failure reason for a pack whose `.tsx` sources failed to compile (`@markii/host`'s `pack-build.ts`) — it still counts toward `packs`, just not `webviewPacks`. */
  readonly skipped: readonly SkippedPackFolder[];
  /**
   * ITEM 4: the ORIGINAL `markii.packs` entries (as configured, not
   * resolved) that are relative once `~` expansion is accounted for
   * (`@markii/host`'s `relativePackEntries`) — a trap because
   * `markii.packs` is USER-scoped (global): a relative entry silently means
   * a different folder in every workspace window it happens to be open in.
   * These entries still resolve and load exactly as before; this is a
   * informational note, never a behavior change. Developer-facing only —
   * `preview-panel.ts`'s `logPackDiagnostics` writes one line per entry to
   * the "Markii" output channel.
   */
  readonly relativeEntries: readonly string[];
  /**
   * Pack CSS authoring warnings (`@markii/host`'s `pack-css-lint.ts` Rule
   * A/B, raw color literals and the missing-namespace-prefix rule) against
   * every built pack's emitted stylesheet — collected from
   * `buildWebviewScript`'s `'built'` outcomes, cache hit or miss alike
   * (`@markii/host`'s `pack-build.ts` re-lints a cached stylesheet on every
   * load). Warnings only, developer-facing: never a build failure, never
   * something shown as page content. `preview-panel.ts`'s
   * `logPackDiagnostics` writes these to the "Markii" output channel
   * (`./pack-diagnostics.ts`).
   */
  readonly cssWarnings: readonly string[];
  /**
   * Packs that ship BOTH a prebuilt `webview.js` and component sources on
   * disk (`@markii/host`'s `resolvePrebuiltPack`'s `shadowedComponentSources`).
   * Informational: the prebuilt script is what actually loads, and the
   * sources sitting next to it are never compiled or read. Never a failure
   * — shipping both is a supported state (docs/packs.md: rebuilding the
   * prebuilt artifacts from those very sources with a host's "build pack
   * for distribution" command is the point). `./pack-diagnostics.ts` turns
   * this into an output-channel-only line, never a window notification and
   * never counted in `skipped`/`skippedPackCount`.
   */
  readonly prebuiltShadowedPacks: readonly {
    readonly name: string;
    readonly folder: string;
  }[];
}

/** Builds one pack's webview registration script from source — injected so this module stays testable without a real esbuild-wasm invocation, and so `preview-panel.ts` can wire up the real `@markii/host`'s `pack-build.ts`'s `buildPackRegistrationScript` with production-specific options (the packaged `esbuild-wasm` location) that this module has no business knowing about. */
export type PackWebviewBuilder = (
  pack: DiscoveredPack,
  cacheDir: string,
) => Promise<PackBuildOutcome>;

/** The default: never attempts a build. Every existing caller/test that omits `options.buildWebviewScript` keeps today's behavior exactly — a pack with no prebuilt `webview.js` is simply excluded from `webviewPacks`, with nothing added to `skipped` (a `'skipped'` outcome is not a failure; see `PackBuildOutcome`'s doc comment). */
const noopBuilder: PackWebviewBuilder = async () => ({ kind: 'skipped' });

export interface LoadPackContextOptions {
  /**
   * An extension-owned directory a compiled registration script may be
   * cached under (never the pack's own folder — AGENTS.md's cleanliness
   * rule keeps the user's file tree clean). Required for `buildWebviewScript`
   * to ever be called at all: with no `cacheDir`, a pack with no prebuilt
   * `webview.js` is excluded from `webviewPacks` exactly like today, and
   * `buildWebviewScript` is never invoked.
   */
  readonly cacheDir?: string;
  /** Defaults to `noopBuilder` (see above). `preview-panel.ts` passes `@markii/host`'s `pack-build.ts`'s `buildPackRegistrationScript`. */
  readonly buildWebviewScript?: PackWebviewBuilder;
  /**
   * Whether an absolute path exists on disk — injected (defaults to
   * `existsSync`) purely so this module stays testable without touching
   * real disk, in the same spirit as `buildWebviewScript` above. Used both
   * for the plain "does this pack have a prebuilt webview.js at all" check
   * and, via `@markii/host`'s `resolvePrebuiltPack`, for the sibling
   * `webview.css`/shadowed-sources checks.
   */
  readonly pathExists?: PackPathExists;
  /**
   * The extension's own install directory (`ExtensionContext.extensionUri.fsPath`,
   * `preview-panel.ts`'s `loadCurrentPackContext`). When given, the
   * bundled packs under `dist/packs` (AGENTS.md's "Bundled packs", GitHub
   * issue #15) are discovered and merged AHEAD of `configuredPacks`, via
   * `./bundled-packs.ts`'s `discoverBundledPacks`/`mergeBundledPacks`.
   * `undefined` (every existing caller/test that omits it) keeps today's
   * behavior exactly: no bundled packs, `configuredPacks` alone.
   */
  readonly extensionPath?: string;
}

/**
 * Loads everything about the packs named by `configuredPacks` (the
 * `markii.packs` setting's raw value) resolved against `workspaceRoot`
 * (see `@markii/host`'s `resolvePackPaths`), with the extension's own
 * bundled packs (`options.extensionPath`) merged in ahead of them. Never
 * throws: every step it composes already degrades quietly (a
 * missing/invalid manifest is skipped, a missing `scripts/` directory
 * contributes no modules, a missing `webview.js` with no
 * `cacheDir`/`buildWebviewScript` configured just excludes that pack from
 * `webviewPacks`, a failed build is recorded in `skipped` rather than
 * thrown, and a user pack whose namespace collides with a bundled one is
 * recorded in `skipped` too — "bundled wins", `./bundled-packs.ts`).
 */
export async function loadPackContext(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
  options: LoadPackContextOptions = {},
): Promise<PackContext> {
  const {
    cacheDir,
    buildWebviewScript = noopBuilder,
    pathExists = existsSync,
    extensionPath,
  } = options;
  const homeDir = homedir();
  const resolvedPaths = resolvePackPaths(
    configuredPacks,
    workspaceRoot,
    homeDir,
  );
  const relativeEntries = relativePackEntries(configuredPacks, homeDir);
  const { folderPaths, archivePaths } =
    partitionConfiguredPackPaths(resolvedPaths);
  const userResult = await discoverPacks(folderPaths, createNodeFileReader());
  // `.mkp` archive entries (GitHub issue #16): loaded read-only from the
  // archive, prebuilt form only, never compiled. See `./archive-packs.ts`.
  // Materialized under a sibling of the pack build cache so it never
  // touches the workspace or the archive's own folder.
  const archiveCacheDir =
    cacheDir !== undefined ? path.join(cacheDir, 'archives') : undefined;
  const archiveResult = await resolveArchivePacksForPreview(
    archivePaths,
    archiveCacheDir,
  );
  const combinedUserResult = mergeArchiveAndFolderPacks(
    userResult.packs,
    archiveResult.packs,
  );
  const bundled =
    extensionPath !== undefined
      ? await discoverBundledPacks(extensionPath)
      : [];
  const merged = mergeBundledPacks(bundled, combinedUserResult.packs);
  const packModules = await loadPackModules(merged.packs);

  const skipped: SkippedPackFolder[] = [
    ...userResult.skipped,
    ...archiveResult.skipped,
    ...combinedUserResult.skipped,
    ...merged.skipped,
  ];
  const webviewPacks: DiscoveredPack[] = [];
  const cssWarnings: string[] = [];
  const prebuiltShadowedPacks: { name: string; folder: string }[] = [];

  for (const pack of merged.packs) {
    const prebuilt = await resolvePrebuiltPack(pack, pathExists);
    if (prebuilt !== undefined) {
      webviewPacks.push({
        ...pack,
        scriptPath: prebuilt.scriptPath,
        ...(prebuilt.stylesheetPath !== undefined
          ? { stylesheetPath: prebuilt.stylesheetPath }
          : {}),
      });
      if (prebuilt.shadowedComponentSources.length > 0) {
        prebuiltShadowedPacks.push({
          name: pack.manifest.name,
          folder: pack.folder,
        });
      }
      continue;
    }
    if (cacheDir === undefined) continue;

    const outcome = await buildWebviewScript(pack, cacheDir);
    if (outcome.kind === 'built') {
      webviewPacks.push({
        ...pack,
        scriptPath: outcome.scriptPath,
        stylesheetPath: outcome.stylesheetPath,
      });
      cssWarnings.push(...outcome.warnings);
    } else if (outcome.kind === 'failed') {
      skipped.push({
        folder: pack.folder,
        reason: `pack "${pack.manifest.name}" registration script build failed (${outcome.reason})`,
      });
    }
    // 'skipped': no build was attempted (default no-op builder, or the
    // real builder itself declining) — quietly excluded, same posture as
    // a pack that never shipped a webview.js at all.
  }

  return {
    packs: merged.packs,
    packModules,
    webviewPacks,
    namespaces: installedNamespaces(merged.packs),
    skipped,
    relativeEntries,
    cssWarnings,
    prebuiltShadowedPacks,
  };
}
