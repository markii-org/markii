/**
 * The DEVICE-LOCAL pack trust list: which installed-pack namespaces this
 * device authorizes to load (docs/packs.md). Every namespace named here
 * has its pack code evaluated at host trust, so the list authorizes code
 * execution and must live in device-local state (the adapter's
 * `memento`), never in anything that travels with a vault, a workspace
 * file, or a sync service.
 *
 * A pack folder can sit in the install root without being trusted: it
 * arrived through a file sync, or a user copied it there by hand. Such a
 * folder is never loaded until its namespace is added here, exactly like
 * a freshly installed one, and the consent prompt is asked either way.
 * The trust list, not the presence of a folder, decides whether code
 * runs. `../host/pack-trust-behavior.ts` enforces that for every host
 * that declares `trust: 'device-list'`.
 *
 * Pure and environment-free, so the shape and its hostile-input
 * normalization are unit-testable with no host in sight.
 */

/** The memento key this shape lives under. It is the key Obsidian has always stored this list under, so an existing device keeps its trust list. */
export const PACK_TRUST_STORAGE_KEY = 'markii:installedPacks';

/** A sane upper bound on how many namespaces this list may hold : a real device installs a handful of packs; this only exists to bound a hostile or corrupt stored value. */
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
 * back into a well-formed `PackTrustList` : hostile-shape-guarded the same
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
