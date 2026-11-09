/**
 * `vscode`-free logic behind the `markii.removeInstalledPack` command
 * ("Markii: Remove Installed Pack…"): lists the packs installed under this
 * extension's own `installedPacksDir` (`preview-panel.ts`), the same
 * directory "Markii: Install Pack from File…" writes into
 * (`./install-pack.ts`), so a pack installed there can be taken out again
 * without finding the storage folder by hand.
 *
 * The delete itself, its outcome and its wording are the shared
 * `removePack` behavior of `@markii/host`. This module keeps the listing,
 * the confirmation text, and the `markii.packs` entry removal
 * (`extension.ts`, the same GLOBAL, user-scoped write `./install-pack.ts`
 * makes on install) that follows a successful removal.
 */
import * as path from 'node:path';
import { parsePackManifest } from '@markii/pack';

export interface InstalledPackEntry {
  readonly name: string;
  readonly version?: string;
  readonly directory: string;
}

/** Names of the immediate subdirectories of `absolutePath`, or an empty list if it does not exist / cannot be read. Never rejects, injected so this module is testable without real disk. */
export type ListDirectoryNames = (absolutePath: string) => Promise<string[]>;

/** A file's UTF-8 text, or `undefined` if it does not exist / cannot be read. Never rejects, injected for the same reason as `ListDirectoryNames`. */
export type ReadTextFile = (
  absolutePath: string,
) => Promise<string | undefined>;

/**
 * Every installed pack under `installRoot`: one immediate subdirectory per
 * pack (`./install-pack.ts` names each by its namespace, so this is a plain
 * directory listing), each read through its own `pack.json`. A subdirectory
 * with no `pack.json`, or one that fails to parse, is quietly omitted
 * rather than reported: it is not a pack this command can meaningfully act
 * on, and the ordinary pack-loading path (`./pack-context.ts`) already
 * reports it on the diagnostics surface if it is also configured. Sorted by
 * name so the quick pick this feeds is stable across runs.
 */
export async function listInstalledPacks(
  installRoot: string,
  listDirectoryNames: ListDirectoryNames,
  readTextFile: ReadTextFile,
): Promise<InstalledPackEntry[]> {
  const directoryNames = await listDirectoryNames(installRoot);
  const entries: InstalledPackEntry[] = [];
  for (const directoryName of directoryNames) {
    const directory = path.join(installRoot, directoryName);
    const manifestText = await readTextFile(path.join(directory, 'pack.json'));
    if (manifestText === undefined) continue;
    const parsed = parsePackManifest(manifestText);
    if (!parsed.ok) continue;
    entries.push({
      name: parsed.manifest.name,
      ...(parsed.manifest.version !== undefined
        ? { version: parsed.manifest.version }
        : {}),
      directory,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** The quick pick label for one installed pack: its name, with the version alongside when the manifest declares one. */
export function installedPackQuickPickLabel(pack: InstalledPackEntry): string {
  return pack.version === undefined
    ? pack.name
    : `${pack.name} (${pack.version})`;
}

/** Shown when no pack is installed under this extension's install directory at all. */
export const NO_INSTALLED_PACKS_MESSAGE =
  'Markii: no packs are installed. Use Install Pack from File to add one.';

/** The confirmation prompt's wording: removal deletes files and cannot be undone. */
export function removePackConfirmMessage(pack: InstalledPackEntry): string {
  return `Removing "${pack.name}" deletes its installed files and cannot be undone.`;
}

/** Removes `directory` from `markii.packs`'s existing entries, or `undefined` when it was not listed (so the caller can skip the config write). Symmetric with `./add-pack-folder.ts`'s `appendPackFolder`, which installing a pack already uses to add this same entry. */
export function removePackListEntry(
  existing: readonly string[],
  directory: string,
): string[] | undefined {
  if (!existing.includes(directory)) return undefined;
  return existing.filter((entry) => entry !== directory);
}
