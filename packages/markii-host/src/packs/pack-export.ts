/**
 * The internal compose-and-write path pack packaging builds on (VS Code is
 * the AUTHORING host and owns pack packaging; Obsidian only ever CONSUMES a
 * pack another host produced). Compiles a pack with the existing
 * `./pack-build.ts` machinery, through its normal host-owned cache, exactly
 * like an ordinary preview build; only its OUTPUT is copied. Then writes a
 * clean, distributable folder at a CALLER-CHOSEN destination: `pack.json`
 * (copied verbatim from the pack's own folder), `webview.js`,
 * `webview.css` when the build emitted one, and every `*.lua` file the
 * pack's own `scripts/` directory holds.
 *
 * The pack's SOURCE folder is NEVER written to. Two callers compose
 * through this module: `apps/vscode/src/packs/build-bundled-packs.ts`
 * writes a pack's build output into the extension's own `dist/packs` at
 * build time, and `./pack-export-archive.ts` reuses its `PackExportBuilder`
 * and `PackExportFs` types to build the ONE shape the "Markii: Export
 * Pack" command itself produces, a single `.mkp` archive.
 *
 * Filesystem access is injected (`PackExportFs`), matching every other
 * module in this directory, so this module is testable with in-memory
 * fakes and carries no host-specific save-dialog/notification behavior of
 * its own; `confirmOverwrite` is the one piece of user interaction, and it
 * is injected too.
 */
import * as path from 'node:path';
import type { DiscoveredPack } from './discover.js';
import type { PackBuildOutcome } from './pack-build.js';
import {
  PREBUILT_SCRIPT_FILENAME,
  PREBUILT_STYLESHEET_FILENAME,
} from './prebuilt.js';

const MANIFEST_FILENAME = 'pack.json';
const SCRIPTS_DIRNAME = 'scripts';

/**
 * The filesystem seam, injected so this module is testable with in-memory
 * fakes. `exists`/`readFile`/`listDirectory` never throw (an unreadable or
 * missing path resolves the "absent" value); `writeFile`/`deleteFile`/
 * `makeDirectory` may reject, and `exportPack` wraps every call to them
 * itself, turning a rejection into a `'failed'` outcome rather than
 * throwing.
 */
export interface PackExportFs {
  readonly exists: (absolutePath: string) => Promise<boolean>;
  readonly readFile: (absolutePath: string) => Promise<string | undefined>;
  readonly writeFile: (absolutePath: string, text: string) => Promise<void>;
  readonly deleteFile: (absolutePath: string) => Promise<void>;
  /** Creates a directory (and any missing parents), or resolves if it already exists. May reject on a genuine I/O failure. */
  readonly makeDirectory: (absolutePath: string) => Promise<void>;
  /** Lists the plain file names directly inside a directory (no recursion), or `[]` when the directory does not exist / cannot be read. Never rejects. */
  readonly listDirectory: (absolutePath: string) => Promise<readonly string[]>;
}

/** Asked once before overwriting artifacts that already exist in the destination folder. Resolves true to proceed. */
export type ConfirmPackOverwrite = (request: {
  readonly packName: string;
  readonly existingPaths: readonly string[];
}) => Promise<boolean>;

export type PackExportBuilder = (
  pack: DiscoveredPack,
  cacheDir: string,
) => Promise<PackBuildOutcome>;

export interface ExportPackOptions {
  readonly pack: DiscoveredPack;
  /** The host-owned build cache directory, unchanged: the build still runs through the normal cache, only its OUTPUT is copied into the export folder. */
  readonly cacheDir: string;
  /** The PARENT directory the user chose to export into. */
  readonly destinationDir: string;
  /** The folder name to create inside `destinationDir` — a host defaults this to the pack's own name, but it is user-editable, so it is validated exactly like every other path segment (see `resolveExportTarget`). */
  readonly exportName: string;
  readonly build: PackExportBuilder;
  readonly fs: PackExportFs;
  readonly confirmOverwrite: ConfirmPackOverwrite;
}

export type PackExportOutcome =
  | {
      readonly kind: 'written';
      readonly packName: string;
      /** Absolute path to the exported folder (`destinationDir`/`exportName`). */
      readonly destinationFolder: string;
      readonly manifestPath: string;
      readonly manifestBytes: number;
      readonly scriptPath: string;
      readonly scriptBytes: number;
      readonly stylesheetPath?: string;
      readonly stylesheetBytes?: number;
      /** Set when a stale webview.css from an earlier export was removed because this build emitted no stylesheet. */
      readonly removedStylesheetPath?: string;
      /** How many `*.lua` files were copied from the pack's `scripts/` directory. 0 when the pack has no `scripts/` directory or it holds no `.lua` files. */
      readonly scriptFilesCopied: number;
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
 * Path jail. Joins `segments` onto `root`, or `undefined` when any segment
 * is not a plain path segment (empty, `.`, `..`, containing `/` or `\`, or
 * absolute) or the resolved join would land outside `root`. This is the
 * ONLY function `exportPack` uses to compute a write target: nothing is
 * ever written to a path this function did not itself derive. The
 * caller-supplied `exportName` goes through this exact same validation as
 * every other segment — an `exportName` carrying a separator, `..`, or an
 * absolute path is refused here, before anything is written.
 */
export function resolveExportTarget(
  root: string,
  ...segments: readonly string[]
): string | undefined {
  if (segments.length === 0) return undefined;
  for (const segment of segments) {
    if (segment.length === 0) return undefined;
    if (segment === '.' || segment === '..') return undefined;
    if (segment.includes('/') || segment.includes('\\')) return undefined;
    if (path.isAbsolute(segment)) return undefined;
  }

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    return undefined;
  }
  return target;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `manifest.name` unless empty/whitespace, in which case a placeholder that still reads sensibly in a failure message. */
function packNameOf(pack: DiscoveredPack): string {
  return pack.manifest.name;
}

/**
 * NEVER throws: every failure (an unsafe `exportName`, a build failure, an
 * unreadable build output or `pack.json`, a write that fails) comes back as
 * `{ kind: 'failed', reason }`. A declined overwrite comes back as
 * `{ kind: 'cancelled' }` with nothing written.
 *
 * Order of operations: resolve the destination folder and every write
 * target inside it (path-jailed against `destinationDir`, including the
 * user-supplied `exportName` itself); run the build through the normal
 * cache; read `pack.json` and the built script (and stylesheet, when the
 * build produced one) back as text; list the pack's `scripts/` directory
 * for `.lua` files; ask `confirmOverwrite` once, only if the destination
 * folder already holds files this export would replace; then create the
 * destination folder and write everything.
 */
export async function exportPack(
  options: ExportPackOptions,
): Promise<PackExportOutcome> {
  const {
    pack,
    cacheDir,
    destinationDir,
    exportName,
    build,
    fs,
    confirmOverwrite,
  } = options;
  const packName = packNameOf(pack);

  const destinationFolder = resolveExportTarget(destinationDir, exportName);
  if (destinationFolder === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `"${exportName}" is not a valid export folder name`,
    };
  }

  const manifestTarget = resolveExportTarget(
    destinationFolder,
    MANIFEST_FILENAME,
  );
  const scriptTarget = resolveExportTarget(
    destinationFolder,
    PREBUILT_SCRIPT_FILENAME,
  );
  const stylesheetTarget = resolveExportTarget(
    destinationFolder,
    PREBUILT_STYLESHEET_FILENAME,
  );
  const scriptsDirTarget = resolveExportTarget(
    destinationFolder,
    SCRIPTS_DIRNAME,
  );
  if (
    manifestTarget === undefined ||
    scriptTarget === undefined ||
    stylesheetTarget === undefined ||
    scriptsDirTarget === undefined
  ) {
    return {
      kind: 'failed',
      packName,
      reason: `could not resolve a safe write location inside "${destinationFolder}"`,
    };
  }

  let manifestText: string | undefined;
  try {
    manifestText = await fs.readFile(path.join(pack.folder, MANIFEST_FILENAME));
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
  if (manifestText === undefined) {
    return {
      kind: 'failed',
      packName,
      reason: `pack.json for pack "${packName}" could not be read`,
    };
  }

  let outcome: PackBuildOutcome;
  try {
    outcome = await build(pack, cacheDir);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }

  if (outcome.kind === 'failed') {
    // Verbatim: a host-specific build-failure reason arrives through here,
    // and its single home is that app's own diagnostics module — never
    // reworded on this path.
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
    // the whole export — the script alone is still a usable pack.
  }

  // The pack's own scripts/ directory, copied through verbatim. Absent or
  // unreadable simply yields no script files, matching every other
  // filesystem-adjacent module in this directory's "quiet skip" posture for
  // an individually unreadable entry.
  let scriptEntries: readonly string[] = [];
  try {
    scriptEntries = await fs.listDirectory(pack.scriptsDir);
  } catch {
    scriptEntries = [];
  }
  const luaFilenames = scriptEntries.filter((name) => name.endsWith('.lua'));
  const luaFiles: Array<{ target: string; text: string }> = [];
  for (const filename of luaFilenames) {
    const target = resolveExportTarget(scriptsDirTarget, filename);
    if (target === undefined) continue; // an unsafe entry name is skipped, not fatal
    let text: string | undefined;
    try {
      text = await fs.readFile(path.join(pack.scriptsDir, filename));
    } catch {
      text = undefined;
    }
    if (text === undefined) continue; // unreadable individual file: quietly skipped
    luaFiles.push({ target, text });
  }

  let destinationExists: boolean;
  try {
    destinationExists = await fs.exists(destinationFolder);
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }

  const existingPaths: string[] = [];
  if (destinationExists) {
    const candidates = [
      manifestTarget,
      scriptTarget,
      ...(stylesheetText !== undefined ? [stylesheetTarget] : []),
      ...luaFiles.map((file) => file.target),
    ];
    try {
      for (const candidate of candidates) {
        if (await fs.exists(candidate)) {
          existingPaths.push(candidate);
        }
      }
      // A stale webview.css this export would remove (see below) also
      // counts as "a file this export would replace".
      if (stylesheetText === undefined && (await fs.exists(stylesheetTarget))) {
        existingPaths.push(stylesheetTarget);
      }
    } catch (err) {
      return { kind: 'failed', packName, reason: describeThrown(err) };
    }
  }

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
    await fs.makeDirectory(destinationFolder);

    await fs.writeFile(manifestTarget, manifestText);
    await fs.writeFile(scriptTarget, scriptText);

    let stylesheetBytes: number | undefined;
    let removedStylesheetPath: string | undefined;
    if (stylesheetText !== undefined) {
      await fs.writeFile(stylesheetTarget, stylesheetText);
      stylesheetBytes = Buffer.byteLength(stylesheetText, 'utf8');
    } else if (await fs.exists(stylesheetTarget)) {
      // A stale webview.css from an earlier export would otherwise keep
      // styling the pack even though this build produced none.
      await fs.deleteFile(stylesheetTarget);
      removedStylesheetPath = stylesheetTarget;
    }

    if (luaFiles.length > 0) {
      await fs.makeDirectory(scriptsDirTarget);
      for (const file of luaFiles) {
        await fs.writeFile(file.target, file.text);
      }
    }

    return {
      kind: 'written',
      packName,
      destinationFolder,
      manifestPath: manifestTarget,
      manifestBytes: Buffer.byteLength(manifestText, 'utf8'),
      scriptPath: scriptTarget,
      scriptBytes: Buffer.byteLength(scriptText, 'utf8'),
      ...(stylesheetText !== undefined
        ? { stylesheetPath: stylesheetTarget, stylesheetBytes }
        : {}),
      ...(removedStylesheetPath !== undefined ? { removedStylesheetPath } : {}),
      scriptFilesCopied: luaFiles.length,
      warnings: outcome.warnings,
    };
  } catch (err) {
    return { kind: 'failed', packName, reason: describeThrown(err) };
  }
}
