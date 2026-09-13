/**
 * The `.mkp` pack-install decision logic, merged from
 * `apps/vscode/src/packs/install-pack.ts` and
 * `apps/obsidian/src/packs/install-pack.ts` (survey finding A2: the single
 * biggest duplication finding in the survey — identical function names,
 * identical types, near-identical wording, differing only in that
 * Obsidian refuses a bundled-namespace archive before the consent prompt
 * and VS Code has no such concept).
 *
 * `reservedNamespaces` generalizes Obsidian's `bundledNamespaces`: it
 * defaults to empty, so VS Code's behavior is byte-identical to before
 * (the `'reserved'` outcome branch simply never fires there), and
 * Obsidian's adapter passes its three bundled namespaces
 * (`read`/`dash`/`prep`) through `HostPackSource.reservedNamespaces()`.
 *
 * ORDER IS SECURITY-RELEVANT and preserved exactly: validate the archive,
 * refuse a reserved namespace, ask consent to run the pack's code, ask
 * before replacing an already-installed pack of the same namespace, and
 * only then write anything to disk. Nothing is written until every
 * applicable step has already said yes.
 */
import * as path from 'node:path';
import { openPackArchive } from '@markii/pack';
import { describeArchiveError, writeArchiveContents } from './pack-archive.js';
import type { ArchiveExtractFs } from './pack-archive.js';
import type { HostAdapter, HostLabels } from './adapter.js';

/** Whether a directory already exists under the install root, injected so this module needs no real disk to test. */
export type PackDirectoryExists = (absolutePath: string) => Promise<boolean>;

export interface InstallPackFromArchiveOptions {
  readonly archiveBytes: Uint8Array;
  /** The `.mkp` file's own path, used only in a rejection's diagnostic wording. Never read again once `archiveBytes` is in hand. */
  readonly archivePath: string;
  /** This host's own pack-install directory (`HostPackSource.installRoot()`). Each installed pack gets a subdirectory named by its namespace, since two packs can never share one (docs/packs.md's collision rule), which makes "is this namespace already installed" a plain directory check. */
  readonly installRoot: string;
  readonly exists: PackDirectoryExists;
  readonly extractFs: ArchiveExtractFs;
  /**
   * Namespaces this install may never claim (`HostPackSource.reservedNamespaces()`).
   * Empty for a host with no reserved set (VS Code). Checked before the
   * consent prompt — a reserved namespace cannot be shadowed by an install.
   */
  readonly reservedNamespaces: ReadonlySet<string>;
}

export type InstallPackOutcome =
  | {
      readonly kind: 'installed';
      readonly packName: string;
      readonly installedDir: string;
      readonly replaced: boolean;
    }
  | {
      readonly kind: 'declined';
      readonly step: 'consent' | 'replace';
      readonly packName: string;
    }
  | { readonly kind: 'reserved'; readonly packName: string }
  | { readonly kind: 'rejected'; readonly reason: string };

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Never throws: a validation failure, a declined prompt, or a write
 * failure all come back as a structured outcome. Order: validate the
 * archive first (a rejected archive is never even offered the consent
 * prompt), then refuse a reserved namespace, then ask consent to run its
 * code, then, only if a pack of the same namespace is already installed,
 * ask to replace it. Nothing is written until every applicable step has
 * said yes.
 *
 * Every prompt routes through `adapter.prompt` with `kind:
 * 'pack-install-consent'`/`'pack-replace'`, per `HostAdapter`'s contract —
 * a host that can only show a non-blocking surface must deny rather than
 * assume yes.
 */
export async function installPackFromArchive(
  adapter: HostAdapter,
  options: InstallPackFromArchiveOptions,
): Promise<InstallPackOutcome> {
  const {
    archiveBytes,
    archivePath,
    installRoot,
    exists,
    extractFs,
    reservedNamespaces,
  } = options;

  const opened = await openPackArchive(archiveBytes);
  if (!opened.ok) {
    return {
      kind: 'rejected',
      reason: `"${archivePath}" is not a valid pack archive: ${describeArchiveError(opened.error)}`,
    };
  }

  const packName = opened.archive.manifest.name;

  if (reservedNamespaces.has(packName)) {
    return { kind: 'reserved', packName };
  }

  let consented: boolean;
  try {
    consented = await adapter.prompt({
      kind: 'pack-install-consent',
      message: installConsentMessage(packName, adapter.labels),
      allowLabel: 'Install',
      denyLabel: 'Cancel',
      consequential: true,
    });
  } catch (err) {
    return { kind: 'rejected', reason: describeThrown(err) };
  }
  if (!consented) {
    return { kind: 'declined', step: 'consent', packName };
  }

  const targetDir = path.join(installRoot, packName);
  let alreadyInstalled: boolean;
  try {
    alreadyInstalled = await exists(targetDir);
  } catch (err) {
    return { kind: 'rejected', reason: describeThrown(err) };
  }

  let replaced = false;
  if (alreadyInstalled) {
    let proceed: boolean;
    try {
      proceed = await adapter.prompt({
        kind: 'pack-replace',
        message: installReplaceConfirmMessage(packName),
        allowLabel: 'Replace',
        denyLabel: 'Cancel',
        consequential: true,
      });
    } catch (err) {
      return { kind: 'rejected', reason: describeThrown(err) };
    }
    if (!proceed) {
      return { kind: 'declined', step: 'replace', packName };
    }
    replaced = true;
  }

  try {
    await extractFs.removeDirectory(targetDir);
    await writeArchiveContents(opened.archive, targetDir, extractFs);
  } catch (err) {
    return {
      kind: 'rejected',
      reason: `could not install pack "${packName}": ${describeThrown(err)}`,
    };
  }

  return { kind: 'installed', packName, installedDir: targetDir, replaced };
}

/**
 * The consent prompt's wording (AGENTS.md's product principles: "clean is
 * not silent," and a consent step must say plainly what it authorizes).
 * States outright that the pack's code will run inside the preview, since
 * this is the one place that consent is asked, so it has to say it, not
 * hint at it.
 *
 * CANONICAL WORDING CHOSEN over the two apps' prior copy (report this as a
 * before/after pair): "from someone you trust" (Obsidian's phrasing) over
 * "from a source you trust" (VS Code's), and `labels.previewNoun` ("the
 * Markii preview" for both hosts) in place of VS Code's prior "every
 * Markii preview" — `HostLabels.previewNoun` already gives both hosts the
 * same noun, so the interpolation settles the wording rather than
 * widening `HostLabels` for a distinction the record does not carry.
 */
export function installConsentMessage(
  packName: string,
  labels: HostLabels,
): string {
  return `Installing "${packName}" lets its code run inside ${labels.previewNoun}. Only install a pack from someone you trust.`;
}

/**
 * The collision confirmation's wording: a namespace already installed,
 * asked before replacing it. CANONICAL WORDING: "removes" (VS Code's prior
 * wording) over Obsidian's prior "deletes" — see `tmp/W11-phase1b.md`'s
 * before/after table for the exact strings this replaces.
 */
export function installReplaceConfirmMessage(packName: string): string {
  return `A pack named "${packName}" is already installed. Replacing it removes the installed copy and cannot be undone.`;
}

/**
 * The one result message for the install command, matching this host's
 * wording rules (two short sentences, no em dashes or parentheses in the
 * popup; the full detail goes to the diagnostics surface).
 *
 * `reloadsAutomatically` is a per-host BEHAVIOR fact, not a wording noun:
 * Obsidian's install command reloads every open view's packs immediately
 * after a successful install, so its message says so; VS Code's install
 * command does not (an installed pack still needs to be added to
 * `markii.packs` before anything loads it), so it doesn't. Defaults to
 * `false`.
 */
export function installPackMessage(
  outcome: InstallPackOutcome,
  archivePath: string,
  labels: HostLabels,
  reloadsAutomatically = false,
): string {
  if (outcome.kind === 'rejected') {
    return `Markii: could not install a pack from "${archivePath}". Open ${labels.diagnosticsSurface} for details.`;
  }
  if (outcome.kind === 'reserved') {
    return `Markii: "${outcome.packName}" is built in and cannot be installed. Nothing was installed.`;
  }
  if (outcome.kind === 'declined') {
    return outcome.step === 'consent'
      ? `Markii: install of "${outcome.packName}" cancelled. Nothing was installed.`
      : `Markii: install of "${outcome.packName}" cancelled. The existing pack was kept.`;
  }
  const reloadSuffix = reloadsAutomatically ? ' Markii packs reloaded.' : '';
  return outcome.replaced
    ? `Markii: reinstalled pack "${outcome.packName}".${reloadSuffix}`
    : `Markii: installed pack "${outcome.packName}".${reloadSuffix}`;
}

/** The full diagnostics-surface detail for one install attempt (AGENTS.md's "clean is not silent": the other of a failure's two homes). */
export function installPackDiagnosticLines(
  outcome: InstallPackOutcome,
  archivePath: string,
): string[] {
  if (outcome.kind === 'rejected') {
    return [
      `Install pack from file rejected "${archivePath}": ${outcome.reason}`,
    ];
  }
  if (outcome.kind === 'reserved') {
    return [
      `Install pack from file refused "${archivePath}": pack "${outcome.packName}" is a reserved namespace and cannot be installed.`,
    ];
  }
  if (outcome.kind === 'declined') {
    return [
      `Install pack from file cancelled for "${archivePath}" (pack "${outcome.packName}") at the ${outcome.step} step; nothing was installed.`,
    ];
  }
  return [
    `Install pack from file installed pack "${outcome.packName}" from "${archivePath}" to ${outcome.installedDir}${outcome.replaced ? ' (replacing the previous install)' : ''}.`,
  ];
}
