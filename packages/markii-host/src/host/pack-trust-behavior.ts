/**
 * The shared pack-trust behavior (docs/packs.md, docs/hosts.md's host
 * checklist). A host that declares `HostPackSource.trust: 'device-list'`
 * loads an installed pack only when this device's trust list names its
 * namespace. A folder that sits in the install root without being named
 * there is listed as present but not enabled, and nothing in it is read
 * past its folder name: it is never discovered, never evaluated.
 *
 * The list lives in the adapter's device-local `memento` (the same state
 * the grant model uses), never in anything that travels with a vault or a
 * workspace file. Installing a pack trusts it (the install consent prompt
 * already asked), enabling a present folder asks the same prompt, and
 * disabling or removing withdraws the entry.
 *
 * A host that declares `trust: 'none'` trusts every
 * folder its own policy authorizes, and every function here is inert for
 * it. Neutral on purpose: only the adapter's file and state primitives
 * are used.
 */
import { parsePackManifest, validatePackName } from '@markii/pack';
import { joinPath } from '../path-util.js';
import {
  PACK_TRUST_STORAGE_KEY,
  isPackTrusted,
  normalizePackTrustList,
  trustPack,
  untrustPack,
} from '../packs/pack-trust.js';
import type { PackTrustEntry, PackTrustList } from '../packs/pack-trust.js';
import type { HostAdapter } from './adapter.js';
import { installConsentMessage } from './pack-install.js';

/** One installed pack this device has enabled. */
export interface EnabledPack {
  readonly namespace: string;
  /** Absolute folder under the install root. */
  readonly folder: string;
  /** The version recorded in the trust list, when the pack declared one. */
  readonly version?: string;
}

export interface InstalledPacksListing {
  /** Folders in the install root whose namespace this device trusts. */
  readonly enabled: readonly EnabledPack[];
  /** Folders in the install root this device does not trust: present, never loaded. */
  readonly notEnabled: readonly string[];
}

/** Whether this adapter's pack source gates installed packs on the device trust list and can say where they live. */
export function usesPackTrust(adapter: HostAdapter): boolean {
  return (
    adapter.packs?.trust === 'device-list' &&
    adapter.packs.installRoot !== undefined
  );
}

export function readPackTrust(adapter: HostAdapter): PackTrustList {
  return normalizePackTrustList(
    adapter.memento.get<unknown>(PACK_TRUST_STORAGE_KEY),
  );
}

async function writePackTrust(
  adapter: HostAdapter,
  list: PackTrustList,
): Promise<void> {
  await adapter.memento.update(PACK_TRUST_STORAGE_KEY, list);
}

/**
 * Pure: splits the namespaces found in the install root by the trust
 * list. A trust entry naming a namespace no longer on disk contributes to
 * neither side: there is nothing to load and nothing to report.
 */
export function selectEnabledPacks(
  installRoot: string,
  onDiskNamespaces: readonly string[],
  trust: PackTrustList,
): InstalledPacksListing {
  const byNamespace = new Map<string, PackTrustEntry>(
    trust.entries.map((entry) => [entry.namespace, entry]),
  );
  const enabled: EnabledPack[] = [];
  const notEnabled: string[] = [];
  for (const namespace of onDiskNamespaces) {
    const entry = byNamespace.get(namespace);
    if (entry) {
      enabled.push({
        namespace,
        folder: joinPath(installRoot, namespace),
        ...(entry.version !== undefined ? { version: entry.version } : {}),
      });
    } else {
      notEnabled.push(namespace);
    }
  }
  return { enabled, notEnabled };
}

/** Lists the install root through the adapter and splits it by trust. A host without trust returns everything as neither: callers check `usesPackTrust` first. Never throws. */
export async function listInstalledPacks(
  adapter: HostAdapter,
): Promise<InstalledPacksListing> {
  const installRoot = adapter.packs?.installRoot?.();
  if (installRoot === undefined) return { enabled: [], notEnabled: [] };
  let names: string[];
  try {
    names = (await adapter.listFolder(installRoot))
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name)
      .sort();
  } catch {
    names = [];
  }
  return selectEnabledPacks(installRoot, names, readPackTrust(adapter));
}

/** The folders the trust gate lets load, for `authorizedFolders` to be extended with. Empty for a host that does not use trust. */
export async function trustedPackFolders(
  adapter: HostAdapter,
): Promise<readonly string[]> {
  if (!usesPackTrust(adapter)) return [];
  return (await listInstalledPacks(adapter)).enabled.map((p) => p.folder);
}

/** Reads a pack's declared `version`, or `undefined` for a missing or malformed `pack.json`. Never throws. */
async function readPackVersion(
  adapter: HostAdapter,
  folder: string,
): Promise<string | undefined> {
  try {
    const text = new TextDecoder().decode(
      await adapter.readFile(joinPath(folder, 'pack.json')),
    );
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/** Why a folder's `pack.json` cannot be a pack, or `undefined` when it parses as a valid manifest. Never throws. */
async function manifestProblem(
  adapter: HostAdapter,
  folder: string,
): Promise<string | undefined> {
  let text: string;
  try {
    text = new TextDecoder().decode(
      await adapter.readFile(joinPath(folder, 'pack.json')),
    );
  } catch {
    return 'the folder has no readable pack.json';
  }
  const parsed = parsePackManifest(text);
  return parsed.ok ? undefined : parsed.errors.join('; ');
}

/**
 * Called by the install path after an archive was extracted: records the
 * namespace as trusted on this device. A no-op for a host without trust.
 * Never throws; a refused write is reported on the diagnostics surface.
 */
export async function trustInstalledPack(
  adapter: HostAdapter,
  namespace: string,
  installedDir: string,
): Promise<void> {
  if (!usesPackTrust(adapter)) return;
  try {
    const version = await readPackVersion(adapter, installedDir);
    await writePackTrust(
      adapter,
      trustPack(readPackTrust(adapter), namespace, version),
    );
  } catch (err) {
    adapter.diagnostics(
      `Could not record trust for pack "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// --- enable / disable / forget ---------------------------------------------

export type EnablePackOutcome =
  | { readonly kind: 'enabled'; readonly namespace: string }
  | { readonly kind: 'declined'; readonly namespace: string }
  | { readonly kind: 'not-installed'; readonly namespace: string }
  | { readonly kind: 'reserved'; readonly namespace: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

export type DisablePackOutcome =
  | { readonly kind: 'disabled'; readonly namespace: string }
  | { readonly kind: 'not-enabled'; readonly namespace: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

function invalidReason(namespace: string): string {
  return `"${namespace}" is not a valid pack namespace`;
}

/** Never throws. The caller checks `usesPackTrust` first. */
export async function enablePackViaAdapter(
  adapter: HostAdapter,
  namespace: string,
): Promise<EnablePackOutcome> {
  if (!validatePackName(namespace).ok) {
    return { kind: 'invalid', reason: invalidReason(namespace) };
  }
  const packs = adapter.packs;
  if (packs === undefined || packs.installRoot === undefined) {
    return { kind: 'failed', reason: 'no pack install folder is available' };
  }
  if (packs.reservedNamespaces().has(namespace)) {
    return { kind: 'reserved', namespace };
  }
  const folder = joinPath(packs.installRoot(), namespace);
  try {
    if (!(await adapter.exists(folder))) {
      return { kind: 'not-installed', namespace };
    }
    // A folder that is not a valid pack is refused before the consent
    // prompt: trusting it would record an entry for a namespace that
    // cannot load, and would trust whatever later appears in that folder.
    const problem = await manifestProblem(adapter, folder);
    if (problem !== undefined) {
      return {
        kind: 'failed',
        reason: `could not enable pack "${namespace}": ${problem}`,
      };
    }
    const consented = await adapter.prompt({
      kind: 'pack-install-consent',
      message: installConsentMessage(namespace, adapter.labels),
      allowLabel: 'Enable',
      denyLabel: 'Cancel',
      consequential: true,
    });
    if (!consented) return { kind: 'declined', namespace };
    const version = await readPackVersion(adapter, folder);
    await writePackTrust(
      adapter,
      trustPack(readPackTrust(adapter), namespace, version),
    );
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not enable pack "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { kind: 'enabled', namespace };
}

/** Never throws. The caller checks `usesPackTrust` first. The folder stays on disk. */
export async function disablePackViaAdapter(
  adapter: HostAdapter,
  namespace: string,
): Promise<DisablePackOutcome> {
  if (!validatePackName(namespace).ok) {
    return { kind: 'invalid', reason: invalidReason(namespace) };
  }
  const list = readPackTrust(adapter);
  if (!isPackTrusted(list, namespace)) {
    return { kind: 'not-enabled', namespace };
  }
  try {
    await writePackTrust(adapter, untrustPack(list, namespace));
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not disable pack "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { kind: 'disabled', namespace };
}

/** Withdraws a namespace's trust entry after a removal. A no-op for a host without trust. Never throws. */
export async function forgetPackTrust(
  adapter: HostAdapter,
  namespace: string,
): Promise<void> {
  if (!usesPackTrust(adapter)) return;
  try {
    await writePackTrust(
      adapter,
      untrustPack(readPackTrust(adapter), namespace),
    );
  } catch (err) {
    adapter.diagnostics(
      `Could not withdraw trust for pack "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// --- wording ---------------------------------------------------------------

export function enablePackMessage(outcome: EnablePackOutcome): string {
  switch (outcome.kind) {
    case 'enabled':
      return `Markii: enabled the pack ${outcome.namespace}.`;
    case 'declined':
      return `Markii: the pack ${outcome.namespace} was not enabled.`;
    case 'not-installed':
      return `Markii: no pack named "${outcome.namespace}" is installed. Nothing was enabled.`;
    case 'reserved':
      return `Markii: "${outcome.namespace}" is built in and is always enabled.`;
    case 'invalid':
      return `Markii: ${outcome.reason}. Nothing was enabled.`;
    case 'failed':
      return `Markii: ${outcome.reason}.`;
  }
}

export function enablePackDiagnosticLine(outcome: EnablePackOutcome): string {
  switch (outcome.kind) {
    case 'enabled':
      return `Enable pack enabled "${outcome.namespace}".`;
    case 'declined':
      return `Enable pack declined for "${outcome.namespace}": the consent prompt was refused.`;
    case 'not-installed':
      return `Enable pack found no installed pack "${outcome.namespace}"; nothing was enabled.`;
    case 'reserved':
      return `Enable pack refused "${outcome.namespace}": a built-in pack is always enabled.`;
    case 'invalid':
      return `Enable pack refused: ${outcome.reason}.`;
    case 'failed':
      return `Enable pack failed: ${outcome.reason}`;
  }
}

export function disablePackMessage(outcome: DisablePackOutcome): string {
  switch (outcome.kind) {
    case 'disabled':
      return `Markii: disabled the pack ${outcome.namespace}. Its folder was left in place.`;
    case 'not-enabled':
      return `Markii: the pack "${outcome.namespace}" is not enabled. Nothing changed.`;
    case 'invalid':
      return `Markii: ${outcome.reason}. Nothing changed.`;
    case 'failed':
      return `Markii: ${outcome.reason}.`;
  }
}

export function disablePackDiagnosticLine(outcome: DisablePackOutcome): string {
  switch (outcome.kind) {
    case 'disabled':
      return `Disable pack disabled "${outcome.namespace}"; its folder was left in place.`;
    case 'not-enabled':
      return `Disable pack found "${outcome.namespace}" not enabled; nothing changed.`;
    case 'invalid':
      return `Disable pack refused: ${outcome.reason}.`;
    case 'failed':
      return `Disable pack failed: ${outcome.reason}`;
  }
}

/** One line per folder that is present in the install root but not enabled on this device. Informational, not a failure. */
export function notEnabledPackDiagnosticLine(
  namespace: string,
  deviceNoun: string,
): string {
  return `Pack "${namespace}" is present but not enabled on ${deviceNoun}; it was not loaded.`;
}
