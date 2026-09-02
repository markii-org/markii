/**
 * The three packs Markii ships with (docs/packs.md's "Bundled packs"
 * section, GitHub issue #15): `read`, `dash`, `prep`, maintained as plain
 * sources at the repo's own `packs/<name>/` and compiled into the prebuilt
 * form at plugin BUILD time (`../../esbuild.options.mjs`'s
 * `buildEmbeddedBundledPacks`, which reuses `@markii/host`'s
 * `buildPackRegistrationScript` rather than a second compiler). The build
 * substitutes `./bundled-packs-embedded.ts`'s placeholder export with the
 * real payload, base64, the same pattern `../run/embedded-assets.ts` uses
 * for the Run path's worker bundle and wasmoon's `glue.wasm` — see that
 * file's own top comment for why the whole substituted file is nothing but
 * the one export.
 *
 * This module is the decode-and-shape half on the CONSUMING side:
 * `decodeBundledPackAssets` turns the embedded base64 into plain data
 * (never throws — a corrupted or missing embed decodes to `[]`, the same
 * "nothing bundled" outcome a dev/Vitest run sees from the placeholder),
 * and `resolveBundledPacks` turns that data into the same `DiscoveredPack`
 * shape `../packs/discover.ts` produces for an on-disk pack, so
 * `./pack-context.ts` can fold a bundled pack into its pipeline as an
 * ordinary pack rather than a special case sprinkled through that file.
 *
 * `obsidian`-free: plain strings and `@markii/host`/`@markii/pack` types
 * only, so this stays unit-testable without a real vault or a real build.
 */
import { parsePackManifest } from '@markii/pack';
import type { DiscoveredPack, SkippedPackFolder } from '@markii/host';
import { decodeBase64 } from '../run/decode-base64.js';
import { EMBEDDED_BUNDLED_PACKS_BASE64 } from './bundled-packs-embedded.js';

/**
 * One bundled pack's prebuilt artifacts, exactly what the build step reads
 * off disk for one `packs/<name>` folder: the manifest's raw JSON text (so
 * it can be re-validated the same way an on-disk manifest is, rather than
 * trusted blindly), the compiled registration script text, an optional
 * compiled stylesheet, and any `scripts/*.lua` the pack ships (none of the
 * three bundled packs ship any today, but the shape carries them so a
 * future bundled pack that does needs no format change).
 */
export interface BundledPackAsset {
  readonly name: string;
  readonly manifestJson: string;
  readonly scriptText: string;
  readonly cssText?: string;
  readonly luaModules: Readonly<Record<string, string>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one hostile-shape-guarded string field, or `undefined` if it is missing or not a string. */
function stringField(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/** Validates and copies one bundled asset's `luaModules` map, dropping any non-string entry rather than failing the whole asset — same posture as `@markii/host`'s `pack-scripts.ts`. */
function luaModulesField(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!Object.hasOwn(obj, 'luaModules')) return result;
  const raw = obj.luaModules;
  if (!isPlainObject(raw)) return result;
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * Decodes one asset entry, or `undefined` if it does not have the minimum
 * required shape (`name`, `manifestJson`, `scriptText` all strings). Never
 * throws.
 */
function decodeAsset(entry: unknown): BundledPackAsset | undefined {
  if (!isPlainObject(entry)) return undefined;
  const name = stringField(entry, 'name');
  const manifestJson = stringField(entry, 'manifestJson');
  const scriptText = stringField(entry, 'scriptText');
  if (
    name === undefined ||
    manifestJson === undefined ||
    scriptText === undefined
  ) {
    return undefined;
  }
  const cssText = stringField(entry, 'cssText');
  return {
    name,
    manifestJson,
    scriptText,
    ...(cssText !== undefined ? { cssText } : {}),
    luaModules: luaModulesField(entry),
  };
}

/**
 * Decodes the base64 payload the build embeds into `BundledPackAsset[]`.
 * Never throws: a placeholder empty string (running from source, before
 * the plugin build has ever run), corrupted base64, non-JSON content, or a
 * JSON value that isn't an array of asset-shaped objects all decode to
 * `[]` — the same "nothing bundled" outcome the Run path's
 * `decodeBase64`/`embedded-assets.ts` placeholder already gives for the
 * worker bundle.
 */
export function decodeBundledPackAssets(
  base64: string,
): readonly BundledPackAsset[] {
  const bytes = decodeBase64(base64);
  if (bytes === undefined) return [];
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const assets: BundledPackAsset[] = [];
  for (const entry of parsed) {
    const asset = decodeAsset(entry);
    if (asset !== undefined) assets.push(asset);
  }
  return assets;
}

/** The real, production accessor: decodes whatever the plugin build embedded into `./bundled-packs-embedded.ts`. A dev/Vitest run (no build has ever substituted that placeholder) sees an empty list, same as a genuinely empty embed. */
export function bundledPackAssets(): readonly BundledPackAsset[] {
  return decodeBundledPackAssets(EMBEDDED_BUNDLED_PACKS_BASE64);
}

/** One bundled pack, resolved into the shape `./pack-context.ts`'s existing pipeline already knows how to evaluate and merge. */
export interface ResolvedBundledPack {
  readonly pack: DiscoveredPack;
  readonly scriptText: string;
  readonly cssText: string | undefined;
  readonly luaModules: Readonly<Record<string, string>>;
}

export interface ResolveBundledPacksResult {
  readonly resolved: readonly ResolvedBundledPack[];
  /** A bundled asset that failed to parse, or duplicated another bundled asset's namespace — should never happen for a build produced by this repo's own build step, but validated anyway rather than trusted blindly (a stale or hand-edited embed is still foreign data by the time it reaches this module). */
  readonly invalid: readonly SkippedPackFolder[];
}

/** The synthetic `folder` a bundled pack reports on its `DiscoveredPack` and in diagnostics — there is no real folder once compiled into `main.js`, but every consumer of `DiscoveredPack` (diagnostics lines, the prebuilt-shadow check) expects a string here. */
export function bundledPackFolderLabel(name: string): string {
  return `bundled:${name}`;
}

/**
 * Validates and shapes every bundled asset into a `DiscoveredPack` plus its
 * compiled script/stylesheet/Lua modules. Never throws: a malformed
 * manifest or a namespace repeated across two bundled assets is recorded
 * in `invalid` and excluded from `resolved`, the same "skip, don't crash"
 * posture `@markii/host`'s `discoverPacks` already takes for an on-disk
 * pack.
 */
export function resolveBundledPacks(
  assets: readonly BundledPackAsset[],
): ResolveBundledPacksResult {
  const resolved: ResolvedBundledPack[] = [];
  const invalid: SkippedPackFolder[] = [];
  const seenNamespaces = new Set<string>();

  for (const asset of assets) {
    const folder = bundledPackFolderLabel(asset.name);
    const parsed = parsePackManifest(asset.manifestJson);
    if (!parsed.ok) {
      invalid.push({
        folder,
        reason: `bundled pack "${asset.name}" manifest is invalid (${parsed.errors.join('; ')})`,
      });
      continue;
    }
    if (seenNamespaces.has(parsed.manifest.name)) {
      invalid.push({
        folder,
        reason: `bundled pack namespace "${parsed.manifest.name}" is duplicated among bundled packs and was not installed`,
      });
      continue;
    }
    seenNamespaces.add(parsed.manifest.name);

    resolved.push({
      pack: {
        folder,
        manifest: parsed.manifest,
        componentPaths: {},
        scriptsDir: `${folder}/scripts`,
        scriptPath: `${folder}/webview.js`,
        ...(asset.cssText !== undefined
          ? { stylesheetPath: `${folder}/webview.css` }
          : {}),
      },
      scriptText: asset.scriptText,
      cssText: asset.cssText,
      luaModules: asset.luaModules,
    });
  }

  return { resolved, invalid };
}

/** Every bundled pack's `DiscoveredPack`, in bundled order — what `../main.ts`'s Insert Component and completion-catalog flows prepend ahead of the user's own configured packs so a namespace a bundled pack already claims wins there too (`@markii/host`'s `buildComponentCatalog` keeps the FIRST pack to claim a composed directive name). */
export function bundledDiscoveredPacks(
  assets: readonly BundledPackAsset[] = bundledPackAssets(),
): readonly DiscoveredPack[] {
  return resolveBundledPacks(assets).resolved.map((entry) => entry.pack);
}
