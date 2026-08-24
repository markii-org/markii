/**
 * Node-side, `vscode`-free discovery of installed component packs
 * (docs/packs.md, GitHub issue #3 slice 5). Given the folders named by the
 * `markii.packs` setting, reads each folder's `pack.json`, validates it
 * with `@markii/pack`'s `parsePackManifest`, and returns a model of what
 * was found: the manifest plus absolute, host-resolved paths to the
 * pack-relative locations a later slice needs (each component's declared
 * source, and the pack's `scripts/` directory for shared Lua modules).
 *
 * Filesystem access is injected (`readFile`) rather than imported directly,
 * so this whole module is testable with plain in-memory fakes — no real
 * disk, and no `vscode` in the dependency graph at all (this file, unlike
 * `extension.ts`/`preview-panel.ts`, is plain TypeScript vitest can run
 * directly).
 *
 * Cleanliness (AGENTS.md): a folder with no `pack.json`, malformed JSON, or
 * a manifest that fails validation is QUIETLY skipped — never a thrown
 * error or a dump in the UI. A caller that wants to surface *why* a pack
 * failed to load can read `DiscoverPacksResult.skipped`, which is optional,
 * developer-facing detail (e.g. an "Open Webview Developer Tools" console
 * line), never something shown as page content.
 */
import * as path from 'node:path';
import { readFile as nodeReadFile } from 'node:fs/promises';
import { parsePackManifest } from '@markii/pack';
import type { PackManifest } from '@markii/pack';
import { detectNamespaceCollisions } from '@markii/pack';

/** Reads a file's UTF-8 text, or resolves `undefined` if it does not exist / cannot be read. Never rejects for an ordinary "not found" — injected so this module needs no real filesystem to test. */
export type PackFileReader = (
  absolutePath: string,
) => Promise<string | undefined>;

/** One successfully discovered, validated pack. */
export interface DiscoveredPack {
  /** The configured folder this pack was discovered in (absolute path, as given). */
  readonly folder: string;
  readonly manifest: PackManifest;
  /** Local component name -> absolute path to its declared source file (`manifest.components[name]`, resolved against `folder`). Informational: what a host consumes them for (bundling, `import()`, or — for the VS Code webview — locating the pack's prebuilt registration script) is that host's own concern. */
  readonly componentPaths: Readonly<Record<string, string>>;
  /** Absolute path to this pack's `scripts/` directory (docs/packs.md: shared Lua modules travel here). The directory need not actually exist — a pack with no shared Lua simply has nothing under it. */
  readonly scriptsDir: string;
  /**
   * Absolute path to this pack's prebuilt VS Code webview registration
   * script (`webview.js`, sibling to `pack.json`) — a VS-Code-host-specific
   * CONVENTION layered on top of the neutral pack contract (`@markii/pack`'s
   * `PackManifest.components` only names pack-relative SOURCE paths for a
   * bundler, per docs/packs.md; it says nothing about a prebuilt browser
   * artifact). See `preview-panel.ts`'s doc comment on the registration
   * convention for what this file must do. The file need not actually
   * exist — a pack with no such script simply never contributes anything to
   * the webview's registry, and every directive under its namespace falls
   * through to the standard unknown-component fallback (the same
   * engine-gating posture `@markii/react`'s `loadPack` already takes for an
   * unsupported `engine`).
   */
  readonly webviewScriptPath: string;
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

/** The real, Node-backed `PackFileReader` — what `preview-panel.ts` supplies in the packaged extension and in dev. Never rejects: an unreadable/missing path resolves `undefined`, matching `PackFileReader`'s contract. */
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

/**
 * Discovers and validates a pack in each of `folders`, in order, then
 * removes (and reports via `collisions`) every pack whose namespace repeats
 * across the set. Duplicate folder entries in `folders` collapse to one
 * discovery attempt each (`Set`), so a repeated setting entry can never
 * itself manufacture a spurious collision.
 */
export async function discoverPacks(
  folders: readonly string[],
  readFile: PackFileReader,
): Promise<DiscoverPacksResult> {
  const uniqueFolders = [...new Set(folders)];
  const found: DiscoveredPack[] = [];
  const skipped: SkippedPackFolder[] = [];

  for (const folder of uniqueFolders) {
    const manifestPath = manifestPathFor(folder);
    let text: string | undefined;
    try {
      text = await readFile(manifestPath);
    } catch {
      text = undefined;
    }
    if (text === undefined) {
      skipped.push({ folder, reason: 'no readable pack.json' });
      continue;
    }

    const result = parsePackManifest(text);
    if (!result.ok) {
      skipped.push({
        folder,
        reason: `invalid pack.json (${result.errors.join('; ')})`,
      });
      continue;
    }

    const componentPaths: Record<string, string> = {};
    for (const localName of Object.keys(result.manifest.components)) {
      if (!Object.hasOwn(result.manifest.components, localName)) continue;
      const relativeSource = result.manifest.components[localName];
      if (relativeSource === undefined) continue;
      componentPaths[localName] = path.join(folder, relativeSource);
    }

    found.push({
      folder,
      manifest: result.manifest,
      componentPaths,
      scriptsDir: path.join(folder, 'scripts'),
      webviewScriptPath: path.join(folder, 'webview.js'),
    });
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
