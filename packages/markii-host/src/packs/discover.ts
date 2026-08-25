/**
 * Node-side, host-UI-free discovery of installed component packs
 * (docs/packs.md, GitHub issue #3 slice 5). Given the folders named by a
 * host's own pack-folder setting (VS Code's `markii.packs`, this plugin's
 * device-local pack-folder list, or any future host's equivalent), reads
 * each folder's `pack.json`, validates it with `@markii/pack`'s
 * `parsePackManifest`, and returns a model of what was found: the manifest
 * plus absolute, host-resolved paths to the pack-relative locations a
 * later step needs (each component's declared source, and the pack's
 * `scripts/` directory for shared Lua modules).
 *
 * Lives in `@markii/host` (not any one app) because it is pure logic over
 * paths, manifests, and strings — no `vscode`, no `obsidian`, no React, and
 * no knowledge of which host is calling it. `apps/vscode/src/packs/`'s
 * `apps/obsidian/src/packs/` copies of this file (pre-dating this hoist)
 * differed only in the field names below (`scriptPath`/`stylesheetPath` —
 * see those fields' own doc comments for why the neutral names won).
 *
 * Filesystem access is injected (`readFile`) rather than imported directly,
 * so this whole module is testable with plain in-memory fakes.
 *
 * Cleanliness (AGENTS.md): a folder with no `pack.json`, malformed JSON, or
 * a manifest that fails validation is QUIETLY skipped — never a thrown
 * error or a dump in the UI. A caller that wants to surface *why* a pack
 * failed to load can read `DiscoverPacksResult.skipped`, which is optional,
 * developer-facing detail (a host's own diagnostics surface), never
 * something shown as page content.
 */
import * as path from 'node:path';
import { readdir, readFile as nodeReadFile } from 'node:fs/promises';
import { parsePackManifest } from '@markii/pack';
import type { PackManifest } from '@markii/pack';
import { detectNamespaceCollisions } from '@markii/pack';

/** Reads a file's UTF-8 text, or resolves `undefined` if it does not exist / cannot be read. Never rejects for an ordinary "not found" — injected so this module needs no real filesystem to test. */
export type PackFileReader = (
  absolutePath: string,
) => Promise<string | undefined>;

/** Lists one directory's immediate entries, or `[]` if it does not exist / cannot be read / is not a directory. Never rejects — injected (like `PackFileReader`) so the one-level parent-folder scan below is testable without real disk. */
export type PackDirectoryLister = (
  absoluteDir: string,
) => Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>;

/** The real, Node-backed `PackDirectoryLister` — what a host's own pack-loading composition (e.g. `apps/vscode/src/packs/pack-context.ts`, `apps/obsidian/src/packs/pack-context.ts`) supplies in production. Never rejects: an unreadable/missing/non-directory path resolves `[]`. */
export function createNodeDirectoryLister(): PackDirectoryLister {
  return async (absoluteDir) => {
    try {
      const entries = await readdir(absoluteDir, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return [];
    }
  };
}

/** A sane upper bound on how many immediate children of one configured folder the one-level parent-folder scan (`discoverPacks`) will probe for a `pack.json` — defense in depth against a pathological folder (thousands of entries, a symlink farm) turning "load the installed packs" into an unbounded scan. Matches the spirit of `./pack-scripts.ts`'s `MAX_SCRIPT_FILES_PER_PACK`. */
const MAX_CHILD_FOLDERS_PER_PARENT = 200;

/** One successfully discovered, validated pack. */
export interface DiscoveredPack {
  /** The configured folder this pack was discovered in (absolute path, as given). */
  readonly folder: string;
  readonly manifest: PackManifest;
  /** Local component name -> absolute path to its declared source file (`manifest.components[name]`, resolved against `folder`). Informational: what a host consumes them for (bundling, `import()`, or locating the pack's prebuilt registration script) is that host's own concern. */
  readonly componentPaths: Readonly<Record<string, string>>;
  /** Absolute path to this pack's `scripts/` directory (docs/packs.md: shared Lua modules travel here). The directory need not actually exist — a pack with no shared Lua simply has nothing under it. */
  readonly scriptsDir: string;
  /**
   * Absolute path to this pack's prebuilt registration script (`webview.js`,
   * sibling to `pack.json`) — a HOST-SPECIFIC CONVENTION layered on top of
   * the neutral pack contract (`@markii/pack`'s `PackManifest.components`
   * only names pack-relative SOURCE paths for a bundler, per
   * docs/packs.md; it says nothing about a prebuilt browser artifact).
   * Named `scriptPath`, not `webviewScriptPath`: this field is read by
   * every host that loads a pack's compiled registration script, not only
   * a host with an actual webview (e.g. an Obsidian plugin evaluates it
   * in-process — see that host's `pack-runtime.ts`), and this package has
   * no webview of its own. The on-disk filename convention (`webview.js`)
   * is unchanged — a script authored for one host still works for another,
   * since the compiled-artifact contract itself
   * (`window.__markiiRegisterPack`/lazy `window.__markiiReact`) is
   * host-neutral (see `./pack-build.ts`'s top doc comment). The file need
   * not actually exist — a pack with no such script simply never
   * contributes anything to a host's registry, and every directive under
   * its namespace falls through to the standard unknown-component
   * fallback (the same engine-gating posture `@markii/react`'s `loadPack`
   * already takes for an unsupported `engine`).
   */
  readonly scriptPath: string;
  /**
   * Absolute path to this pack's emitted stylesheet, when one exists — a
   * SIBLING of `scriptPath`'s compiled output (`./pack-build.ts`, same
   * cache directory, same content-hash base name, `.css` in place of
   * `.js`). `undefined` here always: discovery itself never scans for one,
   * only a host's own pack-context composition knows whether a build
   * actually produced a stylesheet — it overrides this field on the
   * `DiscoveredPack` copy it uses once `buildPackRegistrationScript`'s
   * outcome carries a `stylesheetPath`. A pack that ships its own prebuilt
   * `webview.js` (no compile step at all) has no established
   * sibling-stylesheet convention and never gets one here either.
   */
  readonly stylesheetPath?: string;
}

/** One folder that did not produce a usable pack, and why — developer-facing only, never shown as page content. */
export interface SkippedPackFolder {
  readonly folder: string;
  readonly reason: string;
}

export interface DiscoverPacksResult {
  /** Every pack that validated AND whose namespace does not collide with another discovered pack. Empty when every configured folder was invalid or every valid pack collided. */
  readonly packs: readonly DiscoveredPack[];
  /** Namespaces that appeared more than once across the configured folders (docs/packs.md: "Installing two packs with the same namespace is rejected at install time") — every pack sharing a colliding namespace is excluded from `packs`, not just the second one, so install stays all-or-nothing per namespace. */
  readonly collisions: readonly string[];
  /** Folders that produced no pack, with a short reason each (missing/unreadable `pack.json`, malformed JSON, failed manifest validation). */
  readonly skipped: readonly SkippedPackFolder[];
}

/** The real, Node-backed `PackFileReader` — what a host's own pack-loading composition supplies in production. Never rejects: an unreadable/missing path resolves `undefined`, matching `PackFileReader`'s contract. */
export function createNodeFileReader(): PackFileReader {
  return async (absolutePath) => {
    try {
      return await nodeReadFile(absolutePath, 'utf8');
    } catch {
      return undefined;
    }
  };
}

/** `folder`/`pack.json`, joined with the host path separator. */
function manifestPathFor(folder: string): string {
  return path.join(folder, 'pack.json');
}

/** One attempt to load a pack manifest at exactly `folder` (no scanning). `'missing'` distinguishes "no readable pack.json here" (the case that triggers the one-level parent-folder scan in `discoverPacks`) from `'invalid'` (a pack.json existed but failed validation — scanning never triggers for this case, matching "if a configured folder has no pack.json of its own": one WAS found here, it was just malformed). */
type ManifestAttempt =
  | { readonly kind: 'found'; readonly pack: DiscoveredPack }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly reason: string };

async function tryLoadPackAt(
  folder: string,
  readFile: PackFileReader,
): Promise<ManifestAttempt> {
  const manifestPath = manifestPathFor(folder);
  let text: string | undefined;
  try {
    text = await readFile(manifestPath);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    return { kind: 'missing' };
  }

  const result = parsePackManifest(text);
  if (!result.ok) {
    return {
      kind: 'invalid',
      reason: `invalid pack.json (${result.errors.join('; ')})`,
    };
  }

  const componentPaths: Record<string, string> = {};
  for (const localName of Object.keys(result.manifest.components)) {
    if (!Object.hasOwn(result.manifest.components, localName)) continue;
    const relativeSource = result.manifest.components[localName];
    if (relativeSource === undefined) continue;
    componentPaths[localName] = path.join(folder, relativeSource);
  }

  return {
    kind: 'found',
    pack: {
      folder,
      manifest: result.manifest,
      componentPaths,
      scriptsDir: path.join(folder, 'scripts'),
      scriptPath: path.join(folder, 'webview.js'),
    },
  };
}

/**
 * Discovers and validates a pack in each of `folders`, in order, then
 * removes (and reports via `collisions`) every pack whose namespace repeats
 * across the set. Duplicate folder entries in `folders` collapse to one
 * discovery attempt each (`Set`), so a repeated setting entry can never
 * itself manufacture a spurious collision.
 *
 * ONE-LEVEL PARENT-FOLDER SCAN: when a configured folder has no `pack.json`
 * of its own (not "has one that fails validation" — see `ManifestAttempt`'s
 * doc comment), its immediate subfolders are probed the same way, and each
 * one that DOES have a valid `pack.json` counts as its own discovered pack
 * (`folder` set to the child path). This lets a user configure one parent
 * (`packs`) that holds several pack folders (`packs/pack1`, `packs/pack2`)
 * instead of listing each one in the host's setting. Exactly one level
 * deep, never recursive: a grandchild's `pack.json` is never found this
 * way. A parent with neither its own manifest nor any child manifest is
 * skipped exactly as before ("no readable pack.json"), and a child that
 * DOES have a `pack.json` but fails validation is skipped individually, by
 * its own (child) folder path.
 */
export async function discoverPacks(
  folders: readonly string[],
  readFile: PackFileReader,
  listDirectory: PackDirectoryLister = createNodeDirectoryLister(),
): Promise<DiscoverPacksResult> {
  const uniqueFolders = [...new Set(folders)];
  const found: DiscoveredPack[] = [];
  const skipped: SkippedPackFolder[] = [];

  for (const folder of uniqueFolders) {
    const attempt = await tryLoadPackAt(folder, readFile);

    if (attempt.kind === 'found') {
      found.push(attempt.pack);
      continue;
    }
    if (attempt.kind === 'invalid') {
      skipped.push({ folder, reason: attempt.reason });
      continue;
    }

    // 'missing': this folder itself has no pack.json — try its immediate
    // children, one level only.
    let entries: ReadonlyArray<{ name: string; isDirectory: boolean }> = [];
    try {
      entries = await listDirectory(folder);
    } catch {
      entries = [];
    }

    let anyChildManifest = false;
    for (const entry of entries.slice(0, MAX_CHILD_FOLDERS_PER_PARENT)) {
      if (!entry.isDirectory) continue;
      const childFolder = path.join(folder, entry.name);
      const childAttempt = await tryLoadPackAt(childFolder, readFile);
      if (childAttempt.kind === 'found') {
        found.push(childAttempt.pack);
        anyChildManifest = true;
      } else if (childAttempt.kind === 'invalid') {
        skipped.push({ folder: childFolder, reason: childAttempt.reason });
        anyChildManifest = true;
      }
      // 'missing' for a child: an ordinary non-pack subfolder, not worth
      // reporting individually.
    }

    if (!anyChildManifest) {
      skipped.push({ folder, reason: 'no readable pack.json' });
    }
  }

  const collisionNames = new Set(
    detectNamespaceCollisions(found.map((pack) => pack.manifest.name)).map(
      (collision) => collision.namespace,
    ),
  );

  const packs = found.filter((pack) => !collisionNames.has(pack.manifest.name));
  for (const pack of found) {
    if (collisionNames.has(pack.manifest.name)) {
      skipped.push({
        folder: pack.folder,
        reason: `pack namespace "${pack.manifest.name}" collides with another configured pack and was not installed`,
      });
    }
  }

  return {
    packs,
    collisions: [...collisionNames],
    skipped,
  };
}

/** The discovered packs' namespaces — what `resolveUses` (`@markii/pack`) checks a note's `uses:` declaration against. */
export function installedNamespaces(
  packs: readonly DiscoveredPack[],
): string[] {
  return packs.map((pack) => pack.manifest.name);
}
