/**
 * `vscode`-free logic behind the `markii.installPack` command ("Markii:
 * Install Pack from File", GitHub issue #16): validates a `.mkp` archive
 * the user picked, asks for consent (its code will run in the preview),
 * asks before replacing an already-installed pack of the same namespace,
 * and unzips it into this extension's own `installed-packs` directory
 * (`preview-panel.ts`'s `installedPacksDir`, under `globalStorageUri`,
 * never the workspace, never a folder the user chose). A successfully
 * installed pack still needs to be ADDED to `markii.packs` for the preview
 * to actually load it; that config write stays in `extension.ts` (only
 * `extension.ts`/`preview-panel.ts` may import `vscode`), reusing
 * `./add-pack-folder.ts`'s `appendPackFolder` exactly like
 * `markii.addPackFolder` already does.
 *
 * A rejected archive installs nothing: `installPackFromArchive` never
 * writes to disk until validation, consent, and (when needed) the replace
 * confirmation have all already succeeded.
 */
import * as path from 'node:path';
import { openPackArchive } from '@markii/pack';
import { describeArchiveError, writeArchiveContents } from './archive-packs.js';
import type { ArchiveExtractFs } from './archive-packs.js';

/** Asks the user to install `packName`, making explicit that its code will run inside the preview. Resolves `true` to proceed. */
export type ConfirmPackInstallConsent = (packName: string) => Promise<boolean>;

/** Asks the user to replace an already-installed pack sharing `packName`'s namespace. Resolves `true` to proceed. */
export type ConfirmPackReplace = (packName: string) => Promise<boolean>;

/** Whether a directory already exists under the install root, injected so this module needs no real disk to test. */
export type PackDirectoryExists = (absolutePath: string) => Promise<boolean>;

export interface InstallPackFromArchiveOptions {
  readonly archiveBytes: Uint8Array;
  /** The `.mkp` file's own path, used only in a rejection's diagnostic wording. Never read again once `archiveBytes` is in hand. */
  readonly archivePath: string;
  /** This extension's own pack-install directory (`preview-panel.ts`'s `installedPacksDir`). Each installed pack gets a subdirectory named by its namespace, since two packs can never share one (docs/packs.md's collision rule), which makes "is this namespace already installed" a plain directory check. */
  readonly installRoot: string;
  readonly exists: PackDirectoryExists;
  readonly extractFs: ArchiveExtractFs;
  readonly confirmConsent: ConfirmPackInstallConsent;
  readonly confirmReplace: ConfirmPackReplace;
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
  | { readonly kind: 'rejected'; readonly reason: string };

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Never throws: a validation failure, a declined prompt, or a write
 * failure all come back as a structured outcome. Order: validate the
 * archive first (a rejected archive is never even offered the consent
 * prompt), then ask consent to run its code, then, only if a pack of the
 * same namespace is already installed, ask to replace it. Nothing is
 * written until every applicable step has said yes.
 */
export async function installPackFromArchive(
  options: InstallPackFromArchiveOptions,
): Promise<InstallPackOutcome> {
  const {
    archiveBytes,
    archivePath,
    installRoot,
    exists,
    extractFs,
    confirmConsent,
    confirmReplace,
  } = options;

  const opened = await openPackArchive(archiveBytes);
  if (!opened.ok) {
    return {
      kind: 'rejected',
      reason: `"${archivePath}" is not a valid pack archive: ${describeArchiveError(opened.error)}`,
    };
  }

  const packName = opened.archive.manifest.name;

  let consented: boolean;
  try {
    consented = await confirmConsent(packName);
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
      proceed = await confirmReplace(packName);
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
 * States outright that the pack's code will run inside every preview,
 * since this is the one place that consent is asked, so it has to say it,
 * not hint at it.
 */
export function installConsentMessage(packName: string): string {
  return `Installing the "${packName}" pack lets its code run inside every Markii preview. Only install a pack from a source you trust.`;
}

/** The collision confirmation's wording: a namespace already installed, asked before replacing it. */
export function installReplaceConfirmMessage(packName: string): string {
  return `A pack named "${packName}" is already installed. Replacing it removes the installed copy and cannot be undone.`;
}

/** The one result message for the command, matching this host's wording rules (two short sentences, no em dashes or parentheses in the popup; the full detail goes to the output channel). */
export function installPackResultMessage(
  outcome: InstallPackOutcome,
  archivePath: string,
): string {
  if (outcome.kind === 'rejected') {
    return `Markii: could not install a pack from "${archivePath}". Open the Markii output for details.`;
  }
  if (outcome.kind === 'declined') {
    return `Markii: install cancelled for pack "${outcome.packName}". Nothing was installed.`;
  }
  return outcome.replaced
    ? `Markii: reinstalled pack "${outcome.packName}".`
    : `Markii: installed pack "${outcome.packName}".`;
}

/** The full diagnostics-channel detail for one install attempt (AGENTS.md's "clean is not silent": the other of a failure's two homes). */
export function installPackDiagnosticLines(
  outcome: InstallPackOutcome,
  archivePath: string,
): string[] {
  if (outcome.kind === 'rejected') {
    return [
      `Install Pack from File rejected "${archivePath}": ${outcome.reason}`,
    ];
  }
  if (outcome.kind === 'declined') {
    return [
      `Install Pack from File cancelled for "${archivePath}" (pack "${outcome.packName}") at the ${outcome.step} step; nothing was installed.`,
    ];
  }
  return [
    `Install Pack from File installed pack "${outcome.packName}" from "${archivePath}" to ${outcome.installedDir}${outcome.replaced ? ' (replacing the previous install)' : ''}.`,
  ];
}
