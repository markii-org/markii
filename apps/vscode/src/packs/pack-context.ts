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
import {
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
}

/**
 * Loads everything about the packs named by `configuredPacks` (the
 * `markii.packs` setting's raw value) resolved against `workspaceRoot`
 * (see `@markii/host`'s `resolvePackPaths`). Never throws: every step it
 * composes already degrades quietly (a missing/invalid manifest is
 * skipped, a missing `scripts/` directory contributes no modules, a
 * missing `webview.js` with no `cacheDir`/`buildWebviewScript` configured
 * just excludes that pack from `webviewPacks`, and a failed build is
 * recorded in `skipped` rather than thrown).
 */
export async function loadPackContext(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
  options: LoadPackContextOptions = {},
): Promise<PackContext> {
  const { cacheDir, buildWebviewScript = noopBuilder } = options;
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredPacks, workspaceRoot, homeDir);
  const relativeEntries = relativePackEntries(configuredPacks, homeDir);
  const result = await discoverPacks(folders, createNodeFileReader());
  const packModules = await loadPackModules(result.packs);

  const skipped: SkippedPackFolder[] = [...result.skipped];
  const webviewPacks: DiscoveredPack[] = [];
  const cssWarnings: string[] = [];

  for (const pack of result.packs) {
    if (existsSync(pack.scriptPath)) {
      webviewPacks.push(pack);
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
    packs: result.packs,
    packModules,
    webviewPacks,
    namespaces: installedNamespaces(result.packs),
    skipped,
    relativeEntries,
    cssWarnings,
  };
}
