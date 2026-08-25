/**
 * DEVICE-LOCAL pack-folder setting: the list of folders this device trusts
 * as installed component packs (docs/packs.md). THE RULE THAT MATTERS MOST
 * (task brief, "Storage"): this list authorizes CODE EXECUTION at host
 * trust — every folder named here has its `.tsx` sources compiled and
 * evaluated in-process (`./pack-context.ts`, `./pack-runtime.ts`), and any
 * `scripts/*.lua` it ships becomes `require`-able from the Run path. It
 * therefore MUST use `app.saveLocalStorage`/`app.loadLocalStorage`
 * (device-local, never synced or shared with a vault), and MUST NEVER use
 * `Plugin.saveData`/`loadData` (vault-synced `data.json` — see
 * `../run/local-storage-memento.ts`'s top comment for the full rationale
 * and `../storage-boundary.test.ts` for the executable half of this rule).
 *
 * Deliberately `obsidian`-free (like `../local-settings.ts`) so the shape
 * and its hostile-input normalization stay unit-testable without the
 * `obsidian` module.
 */

/** The `app.saveLocalStorage`/`loadLocalStorage` key this shape lives under. */
export const PACK_SETTINGS_STORAGE_KEY = 'markii:packSettings';

/** A sane upper bound on how many folders this setting may list — real installs are a handful; this only exists to bound a hostile/corrupt stored value (mirrors `apps/vscode/src/protocol.ts`'s `MAX_PACK_NAMESPACES` posture). */
export const MAX_PACK_FOLDERS = 200;

export interface PackSettings {
  /** Absolute paths preferred; a leading `~` expands to the home directory (`../packs/pack-paths.ts`). A relative entry is honored but reported as deprecated in diagnostics, since it resolves differently in every vault this device opens. */
  readonly packFolders: readonly string[];
}

export const DEFAULT_PACK_SETTINGS: PackSettings = {
  packFolders: [],
};

/**
 * Normalizes whatever `app.loadLocalStorage(PACK_SETTINGS_STORAGE_KEY)`
 * handed back into a well-formed `PackSettings` — hostile-shape-guarded the
 * same way `../local-settings.ts`'s `normalizeLocalSettings` guards its own
 * local-storage read, since this is also hand-editable, foreign-version-shaped
 * data in principle. A non-string entry, an empty/whitespace-only entry, or
 * an entry beyond `MAX_PACK_FOLDERS` is dropped rather than crashing the
 * whole read; duplicates are removed, first occurrence wins.
 */
export function normalizePackSettings(data: unknown): PackSettings {
  if (typeof data !== 'object' || data === null) {
    return { ...DEFAULT_PACK_SETTINGS };
  }
  const raw = data as Record<string, unknown>;
  const rawFolders = raw.packFolders;
  if (!Array.isArray(rawFolders)) {
    return { ...DEFAULT_PACK_SETTINGS };
  }

  const seen = new Set<string>();
  const packFolders: string[] = [];
  for (const entry of rawFolders) {
    if (packFolders.length >= MAX_PACK_FOLDERS) break;
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    packFolders.push(trimmed);
  }

  return { packFolders };
}

/**
 * Appends `folderPath` to `existing`, de-duplicated by exact string match
 * and bounded by `MAX_PACK_FOLDERS`. Returns `undefined` when the folder is
 * already present, or the list is already at the cap, so the caller (the
 * settings tab) can skip the write and tell the user there was nothing to
 * add rather than writing an identical or truncated value.
 */
export function appendPackFolder(
  existing: readonly string[],
  folderPath: string,
): string[] | undefined {
  const trimmed = folderPath.trim();
  if (trimmed.length === 0) return undefined;
  if (existing.includes(trimmed)) return undefined;
  if (existing.length >= MAX_PACK_FOLDERS) return undefined;
  return [...existing, trimmed];
}

/**
 * Removes exactly `folderPath` from `existing`. Returns `undefined` when it
 * was not present, so the caller can skip the write.
 */
export function removePackFolder(
  existing: readonly string[],
  folderPath: string,
): string[] | undefined {
  if (!existing.includes(folderPath)) return undefined;
  return existing.filter((entry) => entry !== folderPath);
}
