/**
 * Validates that a folder a user picked for `markii.addPackFolder`
 * actually holds a usable pack, BEFORE the command reports success
 * (GitHub issue #61), and owns the wording that reports what was found. A
 * folder with no `pack.json`, a malformed one, or one whose declared
 * `engine` this renderer cannot run must not get a success notice: the
 * one message the user reads has to match the outcome, with the detail on
 * the output channel.
 *
 * `vscode`-free: uses `@markii/host`'s `discoverPacks` (the same
 * discovery logic `discoverConfiguredPacks` already runs for every
 * configured folder, including the one-level parent-folder scan for a
 * folder that holds several pack subfolders) with `supportedEngine:
 * 'react'`, so a non-react-engine pack here is treated exactly like the
 * render registry already treats one (`@markii/react`'s `loadPack`):
 * skipped, not silently accepted.
 */
import {
  createNodeFileReader,
  discoverPacks,
  type DiscoveredPack,
  type SkippedPackFolder,
} from '@markii/host';

/** This extension's own renderer engine — matches `@markii/react`'s `REACT_ENGINE_ID`. */
const SUPPORTED_ENGINE = 'react';

export interface PackFolderValidation {
  /** Every usable pack found at `folderPath` itself, or one level below it (a parent folder holding several pack subfolders). Empty when nothing usable was found. */
  readonly packs: readonly DiscoveredPack[];
  /** Every folder (the one picked, or a child of it) that did not produce a usable pack, with a short reason each — for the output channel, never the success/failure notice itself. */
  readonly skipped: readonly SkippedPackFolder[];
}

/**
 * Runs pack discovery against exactly `folderPath`, gated to this
 * renderer's engine. A caller decides what "success" means from
 * `packs.length > 0` and reports `skipped`'s reasons on the diagnostics
 * surface, per AGENTS.md's "clean is not silent": a notice is two short
 * sentences, detail goes to the Markii output channel.
 */
export async function validatePackFolder(
  folderPath: string,
): Promise<PackFolderValidation> {
  const result = await discoverPacks(
    [folderPath],
    createNodeFileReader(),
    undefined,
    SUPPORTED_ENGINE,
  );
  return { packs: result.packs, skipped: result.skipped };
}

/**
 * The notice for a folder that held nothing this renderer can load. Two
 * short sentences: what happened, and where the reasons are. The reasons
 * themselves are `addPackFolderDiagnosticLines`, never the notice.
 */
export function unusablePackFolderMessage(folderPath: string): string {
  return `Markii: "${folderPath}" holds no usable pack, so it was not added. Open the Markii output for details.`;
}

/** The notice for a folder that was added, naming what it provides so the user can tell the add worked. */
export function addedPackFolderMessage(
  validation: PackFolderValidation,
): string {
  const names = validation.packs.map((pack) => pack.manifest.name).join(', ');
  return `Markii: pack folder added. It provides ${names}.`;
}

/**
 * The output-channel lines for one `markii.addPackFolder` run: every pack
 * found, and every folder skipped with its reason. A skipped folder is
 * reported whether or not the add succeeded, since a parent folder can
 * hold both a usable pack and a broken one.
 */
export function addPackFolderDiagnosticLines(
  validation: PackFolderValidation,
  folderPath: string,
): string[] {
  const lines = validation.packs.map(
    (pack) =>
      `Add Pack Folder: found pack "${pack.manifest.name}" in ${pack.folder}.`,
  );
  for (const entry of validation.skipped) {
    lines.push(`Add Pack Folder: skipped ${entry.folder}: ${entry.reason}.`);
  }
  if (lines.length === 0) {
    lines.push(`Add Pack Folder: found no pack.json in ${folderPath}.`);
  }
  return lines;
}
