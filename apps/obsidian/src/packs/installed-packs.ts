/**
 * The installed-pack store (docs/packs.md, AGENTS.md's Host positioning:
 * Obsidian is archive-only, no compiler): packs live one folder per
 * namespace under this plugin's own `packs/` directory
 * (`../main.ts`'s `installedPacksDir`), in prebuilt form only. A folder
 * being present there is not enough to load it — only a namespace this
 * device's trust list (`./pack-trust.ts`) names is actually loaded, so a
 * folder that arrived through Obsidian Sync or a hand copy sits inert
 * until a user explicitly enables it.
 *
 * `listInstalledPackNamespaces` is the one disk-touching piece: it lists
 * `packs/`'s immediate subdirectories, never rejecting for a missing or
 * unreadable install root (a fresh install has none yet). Injected
 * (`PackDirLister`) so it stays swappable for a test, matching every other
 * disk-touching module in this directory.
 *
 * `selectLoadablePackFolders` is the PURE selection: given the namespaces
 * found on disk and the device's trust list, it decides which folders load
 * (present AND trusted) and which are merely present (`notEnabled`) — the
 * settings tab (`../settings-tab.ts`) shows the latter with an Enable
 * control. Kept separate from the disk listing so the decision itself is
 * unit-testable with plain arrays, no temp directories required.
 */
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import type { PackTrustEntry, PackTrustList } from './pack-trust.js';

/** Lists the immediate subdirectory names under `installRoot`, or `[]` when it does not exist or cannot be read. Never throws. */
export type PackDirLister = (installRoot: string) => readonly string[];

/** The real, Node-backed `PackDirLister`. */
export function createNodePackDirLister(): PackDirLister {
  return (installRoot) => {
    try {
      return readdirSync(installRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
}

/** One namespace this device may load: its absolute folder, and the trust entry that authorized it (for its recorded version). */
export interface LoadablePackFolder {
  readonly namespace: string;
  readonly folder: string;
  readonly trustEntry: PackTrustEntry;
}

export interface SelectLoadablePackFoldersResult {
  /** Every on-disk namespace this device trusts, paired with its absolute folder. */
  readonly loadable: readonly LoadablePackFolder[];
  /** Every on-disk namespace this device does NOT trust — present, but not enabled here. */
  readonly notEnabled: readonly string[];
}

/**
 * Pure: decides, from what is actually on disk and what this device
 * trusts, which pack folders load and which sit present-but-not-enabled.
 * A trust-list entry naming a namespace that is no longer on disk (the
 * folder was deleted by hand outside the plugin) contributes to neither
 * list — there is nothing to load and nothing to report as unenabled.
 */
export function selectLoadablePackFolders(
  installRoot: string,
  onDiskNamespaces: readonly string[],
  trustList: PackTrustList,
): SelectLoadablePackFoldersResult {
  const trustByNamespace = new Map(
    trustList.entries.map((entry) => [entry.namespace, entry]),
  );
  const loadable: LoadablePackFolder[] = [];
  const notEnabled: string[] = [];

  for (const namespace of onDiskNamespaces) {
    const trustEntry = trustByNamespace.get(namespace);
    if (trustEntry) {
      loadable.push({
        namespace,
        folder: path.join(installRoot, namespace),
        trustEntry,
      });
    } else {
      notEnabled.push(namespace);
    }
  }

  return { loadable, notEnabled };
}
