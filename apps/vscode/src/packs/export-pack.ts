/**
 * `vscode`-free logic behind the `markii.exportPack` command ("Markii:
 * Export Pack", GitHub issue #16): compiles a configured pack and writes it
 * as a single `.mkp` archive at a location the user picks. VS Code is the
 * AUTHORING host and owns pack packaging; Obsidian only ever consumes an
 * already-exported pack, so this command has no Obsidian counterpart.
 *
 * This module owns everything worth unit-testing except pack discovery
 * itself (hoisted to `./discover-configured-packs.ts`, since the Insert
 * Component command needs the identical "what packs are configured" logic,
 * GitHub issue #17 slice 1): the quick-pick item shape for choosing among
 * several configured packs (plain data, no `vscode.QuickPickItem` import),
 * the raw-byte archive writer, and every user-facing string the command
 * produces, which is that string's one home, matching how
 * `./pack-diagnostics.ts` owns this host's diagnostic wording.
 * `extension.ts` (which already imports `vscode`) is wiring only: it
 * discovers packs via `./discover-configured-packs.ts`, offers a quick pick
 * when there is more than one, calls `@markii/host`'s `exportPackArchive`,
 * asks where to save via a save dialog prefilled with the archive's own
 * file name, writes the bytes with `writePackArchiveFile`, and shows the
 * message this module renders.
 *
 * `createNodePackExportFs` also backs `./build-bundled-packs.ts`, which
 * still writes packs into `dist/packs` at extension build time through
 * `@markii/host`'s folder-writing `exportPack`. That is why its write half
 * (`writeFile`/`deleteFile`/`makeDirectory`) stays even though the command
 * itself now only reads through this seam.
 */
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  DiscoveredPack,
  PackExportArchiveOutcome,
  PackExportFs,
} from '@markii/host';

/**
 * A Node-backed `PackExportFs`. `exists`/`readFile`/`listDirectory` never
 * throw (a missing or unreadable path just resolves the "absent" value,
 * matching `@markii/host`'s other filesystem seams); `writeFile`/
 * `deleteFile`/`makeDirectory` may reject, exactly as `@markii/host`'s
 * `exportPack` expects: it wraps those calls itself and turns a rejection
 * into a `'failed'` outcome rather than throwing. `./build-bundled-packs.ts`
 * is the one remaining caller that needs the write half; the command itself
 * (`exportPackArchive`) only ever reads through this seam.
 */
export function createNodePackExportFs(): PackExportFs {
  return {
    exists: async (absolutePath) => {
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (absolutePath) => {
      try {
        return await readFile(absolutePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    writeFile: async (absolutePath, text) => {
      await writeFile(absolutePath, text, 'utf8');
    },
    deleteFile: async (absolutePath) => {
      await rm(absolutePath);
    },
    makeDirectory: async (absolutePath) => {
      await mkdir(absolutePath, { recursive: true });
    },
    listDirectory: async (absolutePath) => {
      try {
        return await readdir(absolutePath);
      } catch {
        return [];
      }
    },
  };
}

/**
 * The quick-pick item shape for one discovered pack, as plain data — no
 * `vscode.QuickPickItem` dependency. `extension.ts` builds this list in the
 * same order as the packs it discovered, so the index of the chosen item
 * recovers the matching `DiscoveredPack`.
 */
export interface PackExportQuickPickItem {
  readonly label: string;
  readonly description: string;
}

/** `label` is the pack's own name; `description` is the folder it was discovered in, so two same-named packs (which cannot both be installed, but could both be configured before a namespace collision is detected) are still distinguishable in the picker. */
export function packExportQuickPickItem(
  pack: DiscoveredPack,
): PackExportQuickPickItem {
  return { label: pack.manifest.name, description: pack.folder };
}

/** Rounds a byte count up to whole kilobytes, with a floor of 1 KB — an export under 1024 bytes should never read as "0 KB". */
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** Shown when `markii.packs` names no folders at all — there is nothing for the command to offer. */
export const NO_PACKS_CONFIGURED_MESSAGE =
  'Markii: no pack folders are configured. Add one with Markii: Add Pack Folder, then run this command again.';

/**
 * Writes `bytes` to `absolutePath`, creating any missing parent
 * directories first. The one raw-byte write this module needs: an archive
 * export writes exactly one file, so it goes straight to
 * `node:fs/promises`'s `writeFile` rather than composing several writes
 * through the text-oriented `PackExportFs` seam `exportPack` uses.
 */
export async function writePackArchiveFile(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

/**
 * The one result message for the archive export, covering every
 * `PackExportArchiveOutcome` kind plus the write step this module (not
 * `@markii/host`) performs. At most two short sentences, no em dashes, no
 * parentheses, and a failure's reason stays out of the popup: it reaches
 * the Markii output channel instead, via `packArchiveExportDiagnosticLines`.
 * The destination path is chosen by a VS Code save dialog, which already
 * confirms an overwrite itself, so this module has no overwrite wording of
 * its own.
 */
export function packArchiveExportResultMessage(
  outcome: PackExportArchiveOutcome,
  destinationPath: string,
): string {
  if (outcome.kind === 'failed') {
    return `Markii: could not export pack "${outcome.packName}". Open the Markii output for details.`;
  }
  const sizeClause = formatKb(outcome.bytes.byteLength);
  return `Markii: exported pack "${outcome.packName}" to ${destinationPath}. The archive is ${sizeClause}.`;
}

/**
 * The full output-channel detail for one archive export attempt: the other
 * of a failure's two homes (AGENTS.md's "clean is not silent"). A failure
 * contributes its reason VERBATIM, however long, since the popup
 * deliberately omits it. A success records the destination path and byte
 * sizes, plus any pack-CSS lint warnings the build produced.
 */
export function packArchiveExportDiagnosticLines(
  outcome: PackExportArchiveOutcome,
  destinationPath: string,
): string[] {
  if (outcome.kind === 'failed') {
    return [`Export failed for pack "${outcome.packName}": ${outcome.reason}`];
  }
  const lines = [
    `Exported pack "${outcome.packName}" to ${destinationPath}: wrote ${String(outcome.bytes.byteLength)} bytes (webview.js ${String(outcome.scriptBytes)} bytes${outcome.stylesheetBytes !== undefined ? `, webview.css ${String(outcome.stylesheetBytes)} bytes` : ''})`,
  ];
  if (outcome.scriptFilesCopied > 0) {
    lines.push(
      `Exported pack "${outcome.packName}": included ${String(outcome.scriptFilesCopied)} script file${outcome.scriptFilesCopied === 1 ? '' : 's'} from its scripts folder.`,
    );
  }
  lines.push(...outcome.warnings);
  return lines;
}
