/**
 * Removing an installed pack: the one shared behavior behind a host's
 * "remove pack" command. The install root holds one folder per namespace
 * (`pack-install.ts`), so removal is a path join, a reserved-namespace
 * check, and `HostPackSource.removeFolder`. Nothing outside the install
 * root is ever touched: the namespace is validated as a pack name (no
 * separators, no dots) before any path is built.
 */
import * as path from 'node:path';
import { validatePackName } from '@markii/pack';
import type { HostAdapter } from './adapter.js';

export type RemovePackOutcome =
  | { readonly kind: 'removed'; readonly namespace: string }
  | { readonly kind: 'not-installed'; readonly namespace: string }
  | { readonly kind: 'reserved'; readonly namespace: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** Never throws. The caller checks `adapter.packs.installRoot`/`removeFolder` exist first. */
export async function removePackViaAdapter(
  adapter: HostAdapter,
  namespace: string,
  installRoot: string,
  removeFolder: (folder: string) => Promise<void>,
  reservedNamespaces: ReadonlySet<string>,
): Promise<RemovePackOutcome> {
  const valid = validatePackName(namespace);
  if (!valid.ok) {
    return {
      kind: 'invalid',
      reason: `"${namespace}" is not a valid pack namespace`,
    };
  }
  if (reservedNamespaces.has(namespace)) {
    return { kind: 'reserved', namespace };
  }
  const folder = path.join(installRoot, namespace);
  try {
    if (!(await adapter.exists(folder))) {
      return { kind: 'not-installed', namespace };
    }
    await removeFolder(folder);
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not remove pack "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { kind: 'removed', namespace };
}

export function removePackMessage(outcome: RemovePackOutcome): string {
  switch (outcome.kind) {
    case 'removed':
      return `Markii: removed pack "${outcome.namespace}".`;
    case 'not-installed':
      return `Markii: no pack named "${outcome.namespace}" is installed. Nothing was removed.`;
    case 'reserved':
      return `Markii: "${outcome.namespace}" is built in and cannot be removed. Nothing was removed.`;
    case 'invalid':
      return `Markii: ${outcome.reason}. Nothing was removed.`;
    case 'failed':
      return `Markii: ${outcome.reason}.`;
  }
}

export function removePackDiagnosticLine(outcome: RemovePackOutcome): string {
  switch (outcome.kind) {
    case 'removed':
      return `Remove pack removed "${outcome.namespace}".`;
    case 'not-installed':
      return `Remove pack found no installed pack "${outcome.namespace}"; nothing was removed.`;
    case 'reserved':
      return `Remove pack refused "${outcome.namespace}": a built-in pack cannot be removed.`;
    case 'invalid':
      return `Remove pack refused: ${outcome.reason}.`;
    case 'failed':
      return `Remove pack failed: ${outcome.reason}`;
  }
}
