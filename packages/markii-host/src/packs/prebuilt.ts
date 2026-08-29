/**
 * The prebuilt-pack convention (docs/packs.md's "Two ways to run a pack:
 * prebuilt and from source"): a pack that ships a compiled `webview.js`
 * sibling to its `pack.json` is used as-is, no compiler runs. This module
 * adds the second half of that convention (issue #15): an OPTIONAL sibling
 * `webview.css`, injected/removed by a host's own pack-context composition
 * keyed by namespace exactly like a compiled pack's own emitted stylesheet
 * (`./pack-build.ts`'s `stylesheetPath`). A prebuilt pack with no
 * `webview.css` simply has no stylesheet — never an error, matching
 * `./discover.ts`'s "the file need not actually exist" posture for every
 * other pack artifact.
 *
 * Also detects the SHADOWING case docs/packs.md names: "When a pack folder
 * holds both a `webview.js` and sources, the prebuilt script wins and the
 * sources are ignored." `resolvePrebuiltPack` reports exactly which of the
 * manifest-declared component sources are present on disk, so a host's own
 * diagnostics surface can name them (host-specific wording; this module
 * only supplies the facts).
 *
 * Filesystem access is injected (`PackPathExists`), not imported directly,
 * so this module is testable with plain in-memory fakes — matching every
 * other module in this directory.
 */
import * as path from 'node:path';
import type { DiscoveredPack } from './discover.js';

export const PREBUILT_SCRIPT_FILENAME = 'webview.js';
export const PREBUILT_STYLESHEET_FILENAME = 'webview.css';

/** Absolute path of a pack folder's prebuilt registration script. No existence check. */
export function prebuiltScriptPathFor(folder: string): string {
  return path.join(folder, PREBUILT_SCRIPT_FILENAME);
}

/** Absolute path of a pack folder's prebuilt sibling stylesheet. No existence check. */
export function prebuiltStylesheetPathFor(folder: string): string {
  return path.join(folder, PREBUILT_STYLESHEET_FILENAME);
}

/** Whether an absolute path exists. Injected so this module needs no real disk to test; may be sync or async. */
export type PackPathExists = (
  absolutePath: string,
) => boolean | Promise<boolean>;

export interface PrebuiltPackResolution {
  /** Absolute path to the pack's prebuilt webview.js (it exists). */
  readonly scriptPath: string;
  /** Absolute path to the sibling webview.css, present only when that file exists. */
  readonly stylesheetPath?: string;
  /**
   * Absolute paths of the manifest-declared component sources that are
   * present on disk and therefore shadowed by the prebuilt script. Empty
   * when the pack ships no sources (the ordinary distribution shape:
   * `webview.js` alone, docs/packs.md's "This is the form to ship when
   * other people will use your pack").
   */
  readonly shadowedComponentSources: readonly string[];
}

/** Calls `exists`, treating a thrown error the same as "does not exist" — an unreadable path is not proof a file is absent, but this module's contract (like every other filesystem-adjacent module in this directory) is to degrade quietly rather than surface a raw I/O error here. */
async function existsQuietly(
  exists: PackPathExists,
  absolutePath: string,
): Promise<boolean> {
  try {
    return await exists(absolutePath);
  } catch {
    return false;
  }
}

/**
 * Resolves the prebuilt artifacts of one discovered pack, or `undefined`
 * when the pack ships no `webview.js` at all (the from-source path, which a
 * host compiles via `./pack-build.ts` instead).
 *
 * `pack.scriptPath` (already `folder/webview.js` from `./discover.ts`) is
 * used as the script path rather than recomputed, but the stylesheet path
 * is derived from the script path's own directory so the two always stay
 * siblings even if a caller ever hands this a `DiscoveredPack` copy whose
 * `folder` and `scriptPath` were computed independently.
 *
 * Never throws: an `exists` that throws is treated as "does not exist" for
 * every path this function checks.
 */
export async function resolvePrebuiltPack(
  pack: Pick<DiscoveredPack, 'folder' | 'componentPaths' | 'scriptPath'>,
  exists: PackPathExists,
): Promise<PrebuiltPackResolution | undefined> {
  const scriptExists = await existsQuietly(exists, pack.scriptPath);
  if (!scriptExists) return undefined;

  const stylesheetPath = path.join(
    path.dirname(pack.scriptPath),
    PREBUILT_STYLESHEET_FILENAME,
  );
  const stylesheetExists = await existsQuietly(exists, stylesheetPath);

  const shadowedComponentSources: string[] = [];
  for (const sourcePath of Object.values(pack.componentPaths)) {
    if (sourcePath === undefined) continue;
    if (await existsQuietly(exists, sourcePath)) {
      shadowedComponentSources.push(sourcePath);
    }
  }

  return {
    scriptPath: pack.scriptPath,
    ...(stylesheetExists ? { stylesheetPath } : {}),
    shadowedComponentSources,
  };
}
