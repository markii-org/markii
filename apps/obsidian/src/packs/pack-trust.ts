/**
 * DEVICE-LOCAL pack trust list: which installed-pack namespaces this
 * device authorizes to load (docs/packs.md). THE RULE THAT MATTERS MOST
 * (AGENTS.md's storage-boundary rule, mirrored from the deleted
 * `./pack-settings.ts`): this list authorizes CODE EXECUTION at host
 * trust. Every namespace named here has its compiled `webview.js`
 * evaluated in-process (`./pack-context.ts`, `./pack-runtime.ts`), and any
 * `scripts/*.lua` it ships becomes `require`-able from the Run path. It
 * therefore MUST use `app.saveLocalStorage`/`app.loadLocalStorage`
 * (device-local, never synced or shared with a vault), and MUST NEVER use
 * `Plugin.saveData`/`loadData` (vault-synced `data.json` — see
 * `../run/local-storage-memento.ts`'s top comment for the full rationale
 * and `../storage-boundary.test.ts` for the executable half of this rule).
 *
 * A pack folder can exist under this plugin's `packs/` directory without
 * being trusted: it arrived through Obsidian Sync (which syncs the whole
 * vault, `.obsidian/plugins/markii/packs/` included, even though this
 * trust list itself never does), or a user copied it there by hand. Such a
 * folder is never loaded until its namespace is added here, exactly like a
 * freshly installed one — `./install-pack.ts`'s consent prompt is asked
 * either way (`../settings-tab.ts`'s "Enable" control asks it for this
 * case). This is what makes the trust list, not the mere presence of a
 * folder, the thing that decides whether code runs.
 *
 * Deliberately `obsidian`-free (like `./pack-settings.ts` before it) so the
 * shape and its hostile-input normalization stay unit-testable without the
 * `obsidian` module.
 */

/** The `app.saveLocalStorage`/`loadLocalStorage` key this shape lives under. Deliberately a NEW key, not a rename of the deleted `./pack-settings.ts`'s `'markii:packSettings'`: the old key held a list of folder paths with a completely different shape, and reusing the key would let a stale stored value be misread as this one. The old key is simply no longer read. */
export const PACK_TRUST_STORAGE_KEY = 'markii:installedPacks';

/** A sane upper bound on how many namespaces this list may hold — a real vault installs a handful of packs; this only exists to bound a hostile/corrupt stored value (mirrors `apps/vscode/src/protocol.ts`'s `MAX_PACK_NAMESPACES` posture). */
export const MAX_TRUSTED_PACKS = 200;

/** One namespace this device trusts, and the version it was installed at (the manifest's own `version` field, or `undefined` when the pack declares none). */
export interface PackTrustEntry {
  readonly namespace: string;
  readonly version?: string;
}

export interface PackTrustList {
  readonly entries: readonly PackTrustEntry[];
}

export const DEFAULT_PACK_TRUST_LIST: PackTrustList = { entries: [] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes one raw entry, or `undefined` when it does not have a usable `namespace`. A non-string, empty, or whitespace-only `namespace` is dropped rather than crashing the whole read; a non-string `version` is dropped (the entry survives, just without one). */
function normalizeEntry(raw: unknown): PackTrustEntry | undefined {
  if (!isPlainObject(raw)) return undefined;
  const namespace = raw.namespace;
  if (typeof namespace !== 'string') return undefined;
  const trimmed = namespace.trim();
  if (trimmed.length === 0) return undefined;
  const version = raw.version;
  return typeof version === 'string' && version.trim().length > 0
    ? { namespace: trimmed, version: version.trim() }
    : { namespace: trimmed };
}

/**
 * Normalizes whatever `app.loadLocalStorage(PACK_TRUST_STORAGE_KEY)` handed
 * back into a well-formed `PackTrustList` — hostile-shape-guarded the same
 * way every other device-local shape in this plugin is, since this is also
 * hand-editable, foreign-version-shaped data in principle. A malformed
 * entry is dropped rather than failing the whole read; duplicates are
 * removed by namespace, first occurrence wins; the list is bounded by
 * `MAX_TRUSTED_PACKS`.
 */
export function normalizePackTrustList(data: unknown): PackTrustList {
  if (!isPlainObject(data)) return { ...DEFAULT_PACK_TRUST_LIST };
  const rawEntries = data.entries;
  if (!Array.isArray(rawEntries)) return { ...DEFAULT_PACK_TRUST_LIST };

  const seen = new Set<string>();
  const entries: PackTrustEntry[] = [];
  for (const rawEntry of rawEntries) {
    if (entries.length >= MAX_TRUSTED_PACKS) break;
    const entry = normalizeEntry(rawEntry);
    if (!entry) continue;
    if (seen.has(entry.namespace)) continue;
    seen.add(entry.namespace);
    entries.push(entry);
  }
  return { entries };
}

/** Whether `namespace` is trusted on this device. */
export function isPackTrusted(list: PackTrustList, namespace: string): boolean {
  return list.entries.some((entry) => entry.namespace === namespace);
}

/**
 * Adds (or replaces) `namespace`'s trust entry, recording `version` when
 * given. Used both by a fresh install and by "Enable" for a pack folder
 * that was already present on disk. Returns the same list unchanged (never
 * a new object) when the entry is already present with the same version,
 * so a caller can skip a write that would change nothing.
 */
export function trustPack(
  list: PackTrustList,
  namespace: string,
  version?: string,
): PackTrustList {
  const trimmed = namespace.trim();
  if (trimmed.length === 0) return list;
  const existing = list.entries.find((entry) => entry.namespace === trimmed);
  if (existing && existing.version === version) return list;

  const withoutExisting = list.entries.filter(
    (entry) => entry.namespace !== trimmed,
  );
  const next = [
    ...withoutExisting,
    version !== undefined
      ? { namespace: trimmed, version }
      : { namespace: trimmed },
  ];
  return { entries: next.slice(0, MAX_TRUSTED_PACKS) };
}

/**
 * Removes `namespace`'s trust entry. Returns the same list unchanged when
 * it was not present, so a caller can skip a no-op write.
 */
export function untrustPack(
  list: PackTrustList,
  namespace: string,
): PackTrustList {
  if (!list.entries.some((entry) => entry.namespace === namespace)) {
    return list;
  }
  return {
    entries: list.entries.filter((entry) => entry.namespace !== namespace),
  };
}
