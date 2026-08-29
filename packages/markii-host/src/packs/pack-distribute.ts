/**
 * The compose-and-write half of the "build this pack for distribution" host
 * command (issue #15, gap 3: docs/packs.md's "Two ways to run a pack"
 * describes the prebuilt shape as a target to SHIP, but nothing in this
 * repository ever produced one). Compiles a pack with the existing
 * `./pack-build.ts` machinery — through its normal host-owned cache, unlike
 * an ordinary preview build only its OUTPUT is then copied — and writes
 * `webview.js`, plus `webview.css` when the build emitted one, into the
 * pack's OWN folder, so the pack folder itself becomes exactly the prebuilt
 * shape `./prebuilt.ts` reads back.
 *
 * DELIBERATE EXCEPTION TO THE "NEVER WRITE INSIDE A PACK FOLDER" RULE.
 * `./pack-build.ts`'s own doc comment states the rule for every ordinary
 * build: `cacheDir` is host-owned, never the pack's own folder, so a user's
 * file tree stays clean while merely previewing a from-source pack. This
 * module is the one, author-initiated exception: a user who runs a host's
 * "build pack for distribution" command is asking, explicitly, to produce
 * the prebuilt artifacts INSIDE the pack they are packaging up to ship —
 * that is the whole point of the command, and it happens only on that
 * explicit request, never as a side effect of opening a preview. Load-time
 * caching (`./pack-build.ts`'s `cacheDir`) is unchanged by this module: the
 * build this function runs still goes through that same cache, and only the
 * cache's resulting text is copied onward.
 *
 * Filesystem access is injected (`PackDistributionFs`), matching every
 * other module in this directory, so this module is testable with in-memory
 * fakes and carries no host-specific save-dialog/notification behavior of
 * its own — `confirmOverwrite` is the one piece of user interaction, and it
 * is injected too.
 */
import * as path from 'node:path';
import type { DiscoveredPack } from './discover.js';
import type { PackBuildOutcome } from './pack-build.js';
import {
  PREBUILT_SCRIPT_FILENAME,
  PREBUILT_STYLESHEET_FILENAME,
} from './prebuilt.js';

/** The filesystem seam, injected so this module is testable with in-memory fakes. */
export interface PackDistributionFs {
  readonly exists: (absolutePath: string) => Promise<boolean>;
  readonly readFile: (absolutePath: string) => Promise<string | undefined>;
  readonly writeFile: (absolutePath: string, text: string) => Promise<void>;
  readonly deleteFile: (absolutePath: string) => Promise<void>;
}

/** Asked before overwriting artifacts that already exist in the pack folder. Resolves true to proceed. */
export type ConfirmPackOverwrite = (request: {
  readonly packName: string;
  readonly existingPaths: readonly string[];
}) => Promise<boolean>;

export type PackDistributionBuilder = (
  pack: DiscoveredPack,
  cacheDir: string,
) => Promise<PackBuildOutcome>;

export interface BuildPackForDistributionOptions {
  readonly pack: DiscoveredPack;
  /** The host-owned build cache directory, unchanged: the build still runs through the normal cache, only its OUTPUT is copied into the pack folder. */
  readonly cacheDir: string;
  readonly build: PackDistributionBuilder;
  readonly fs: PackDistributionFs;
  readonly confirmOverwrite: ConfirmPackOverwrite;
}

export type PackDistributionOutcome =
  | {
      readonly kind: 'written';
      readonly packName: string;
      readonly scriptPath: string;
      readonly scriptBytes: number;
      readonly stylesheetPath?: string;
      readonly stylesheetBytes?: number;
      /** Set when a stale webview.css from an earlier build was removed because this build emitted no stylesheet. */
      readonly removedStylesheetPath?: string;
      /** The build's pack-CSS lint warnings, passed through unchanged. */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'cancelled'; readonly packName: string }
  | {
      readonly kind: 'failed';
      readonly packName: string;
      readonly reason: string;
    };

/**
 * Path jail. The absolute path of `filename` directly inside `packFolder`,
 * or `undefined` when `filename` is not a plain file name (a separator,
 * `..`, an absolute path, empty) or the resolved join would land outside
 * `packFolder`. This is the ONLY function `buildPackForDistribution` uses
 * to compute a write target: nothing is ever written to a path this
 * function did not itself derive from the discovered pack's own folder.
 */
export function resolveDistributionTarget(
  packFolder: string,
  filename: string,
): string | undefined {
  if (filename.length === 0) return undefined;
  if (filename === '.' || filename === '..') return undefined;
  if (filename.includes('/') || filename.includes('\\')) return undefined;
  if (path.isAbsolute(filename)) return undefined;

  const root = path.resolve(packFolder);
  const target = path.resolve(root, filename);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return undefined;
  }
  return target;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * NEVER throws: every failure (build failure, unreadable build output, a
 * write that fails, a target that would escape the pack folder) comes back
 * as `{ kind: 'failed', reason }`.
 *
 * Order of operations: resolve both write targets inside the pack's own
 * folder; run the build through the normal cache; read the built script
 * (and stylesheet, when the build produced one) back as text; ask
 * `confirmOverwrite` once, only if a target already exists; write the
 * script, write or remove the stylesheet, and report byte sizes.
 */
export async function buildPackForDistribution(
  options: BuildPackForDistributionOptions,
): Promise<PackDistributionOutcome> {
  const { pack, cacheDir, build, fs, confirmOverwrite } = options;
  const packName = pack.manifest.name;

  const scriptTarget = resolveDistributionTarget(
    pack.folder,
    PREBUILT_SCRIPT_FILENAME,
  );
  const stylesheetTarget = resolveDistributionTarget(
    pack.folder,
    PREBUILT_STYLESHEET_FILENAME,
  );
  if (scriptTarget === undefined || stylesheetTarget === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `could not resolve a safe write location inside pack "${packName}"'s own folder`,
    };
  }

  let outcome: PackBuildOutcome;
  try {
    outcome = await build(pack, cacheDir);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }

  if (outcome.kind === 'failed') {
    // Verbatim: Obsidian's no-compiler wording (and any other host-specific
    // build-failure reason) arrives through here, and its single home is
    // that app's own diagnostics module — never reworded on this path.
    return { kind: 'failed', packName, reason: outcome.reason };
  }
  if (outcome.kind === 'skipped') {
    return {
      kind: 'failed',
      packName,
      reason: `pack "${packName}" was not built`,
    };
  }

  let scriptText: string | undefined;
  try {
    scriptText = await fs.readFile(outcome.scriptPath);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
  if (scriptText === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `built script for pack "${packName}" could not be read back`,
    };
  }

  let stylesheetText: string | undefined;
  if (outcome.stylesheetPath !== undefined) {
    try {
      stylesheetText = await fs.readFile(outcome.stylesheetPath);
    } catch {
      stylesheetText = undefined;
    }
    // A read failure here is treated as "no stylesheet" rather than failing
    // the whole command — the script alone is still a usable prebuilt pack.
  }

  let existingScript: boolean;
  let existingStylesheet: boolean;
  try {
    existingScript = await fs.exists(scriptTarget);
    existingStylesheet = await fs.exists(stylesheetTarget);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }

  const existingPaths = [
    ...(existingScript ? [scriptTarget] : []),
    ...(existingStylesheet ? [stylesheetTarget] : []),
  ];
  if (existingPaths.length > 0) {
    let proceed: boolean;
    try {
      proceed = await confirmOverwrite({ packName, existingPaths });
    } catch (err) {
      return { kind: 'failed', packName, reason: describeThrown(err) };
    }
    if (!proceed) {
      return { kind: 'cancelled', packName };
    }
  }

  try {
    await fs.writeFile(scriptTarget, scriptText);
    let stylesheetBytes: number | undefined;
    let removedStylesheetPath: string | undefined;
    if (stylesheetText !== undefined) {
      await fs.writeFile(stylesheetTarget, stylesheetText);
      stylesheetBytes = Buffer.byteLength(stylesheetText, 'utf8');
    } else if (existingStylesheet) {
      // A stale webview.css from an earlier build would otherwise keep
      // styling the pack even though this build produced none.
      await fs.deleteFile(stylesheetTarget);
      removedStylesheetPath = stylesheetTarget;
    }

    return {
      kind: 'written',
      packName,
      scriptPath: scriptTarget,
      scriptBytes: Buffer.byteLength(scriptText, 'utf8'),
      ...(stylesheetText !== undefined
        ? { stylesheetPath: stylesheetTarget, stylesheetBytes }
        : {}),
      ...(removedStylesheetPath !== undefined ? { removedStylesheetPath } : {}),
      warnings: outcome.warnings,
    };
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
}
