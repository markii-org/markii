/**
 * `vscode`-free logic behind the `markii.exportPack` command ("Markii:
 * Export Pack", GitHub issue #16): compiles a configured pack and writes a
 * clean, distributable folder — `pack.json`, `webview.js`, `webview.css`
 * when the build emits one, and any `scripts/*.lua` — at a location the
 * user picks. VS Code is the AUTHORING host and owns pack packaging;
 * Obsidian only ever consumes an already-exported pack, so this command has
 * no Obsidian counterpart. This replaces the earlier
 * `markii.buildPackForDistribution` command, which wrote its output into
 * the pack's own source folder (`@markii/host`'s `packs/pack-export.ts`
 * doc comment has the full history); that command never shipped to the
 * Marketplace, so this is a clean rework with no compatibility alias.
 *
 * This module owns everything worth unit-testing except pack discovery
 * itself (hoisted to `./discover-configured-packs.ts`, since the Insert
 * Component command needs the identical "what packs are configured" logic
 * — GitHub issue #17, slice 1): a plain `node:fs/promises`-backed
 * `PackExportFs` for `@markii/host`'s `exportPack`, the quick-pick item
 * shape (plain data, no `vscode.QuickPickItem` import), the export-folder
 * name validator, and every user-facing string the command produces — this
 * is that string's one home, matching how `./pack-diagnostics.ts` owns this
 * host's diagnostic wording. `extension.ts` (which already imports
 * `vscode`) is wiring only: it discovers packs via `./discover-configured-packs.ts`,
 * offers a quick pick when there is more than one, asks where to export and
 * what to name the folder, calls `@markii/host`'s `exportPack` with this
 * module's `PackExportFs`, and shows the message this module renders.
 *
 * Export Pack also offers a SECOND output shape (GitHub issue #16): a
 * single `.mkp` archive file instead of a folder, built by `@markii/host`'s
 * `exportPackArchive` (the same compile, zipped rather than written as
 * separate files). `packExportFormatQuickPickItems` is that choice's
 * quick-pick data; `writePackArchiveFile`, `archiveExportNameFor`, and the
 * archive-specific wording functions below are this shape's counterparts
 * to the folder shape's equivalents above them.
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
  PackExportFs,
  PackExportOutcome,
  PackExportArchiveOutcome,
} from '@markii/host';

/**
 * A Node-backed `PackExportFs`. `exists`/`readFile`/`listDirectory` never
 * throw (a missing or unreadable path just resolves the "absent" value,
 * matching `@markii/host`'s other filesystem seams); `writeFile`/
 * `deleteFile`/`makeDirectory` may reject, exactly as `@markii/host`'s
 * `exportPack` expects — it wraps those calls itself and turns a rejection
 * into a `'failed'` outcome rather than throwing.
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
 * The `validateInput` function for the export-folder-name input box: an
 * error message when `name` is not a safe, plain folder name (a path
 * separator, `..`, empty, or `.`), or `undefined` when it is fine to use.
 * Kept as a plain function, not inline in `extension.ts`, so it is
 * unit-testable without `vscode`; the same rule `@markii/host`'s
 * `resolveExportTarget` enforces server-side, restated here so a bad name
 * is caught at the input box rather than only after the command runs.
 */
export function exportNameValidationMessage(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Enter a folder name.';
  }
  if (trimmed === '.' || trimmed === '..') {
    return 'Enter a plain folder name, not "." or "..".';
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'Folder name cannot contain a path separator.';
  }
  return undefined;
}

/** The overwrite-confirmation modal's wording, for when the destination folder already has files this export would replace. */
export function packExportOverwriteConfirmMessage(request: {
  readonly packName: string;
  readonly existingPaths: readonly string[];
}): string {
  const single = request.existingPaths.length === 1;
  const noun = single ? 'a file' : 'files';
  const pronoun = single ? 'it' : 'them';
  return `Markii: the destination already has ${noun} from an earlier export of pack "${request.packName}". Overwrite ${pronoun}?`;
}

/**
 * The one result message for the command, covering every
 * `PackExportOutcome` kind. A success names the destination folder and the
 * written files' sizes; the stylesheet clause is dropped when the build
 * produced none. At most two short sentences, matching this host's wording
 * rules: no em dashes, no parentheses.
 */
export function packExportResultMessage(outcome: PackExportOutcome): string {
  if (outcome.kind === 'cancelled') {
    return `Markii: export cancelled for pack "${outcome.packName}". Nothing was written.`;
  }
  if (outcome.kind === 'failed') {
    // The REASON deliberately does not go in the popup: an export failure's
    // reason is often a multi-line compiler error, and AGENTS.md's
    // cleanliness rule keeps an error dump out of the quiet marker. It
    // reaches the other of a failure's two homes instead, verbatim, via
    // `packExportDiagnosticLines` and the Markii output channel.
    return `Markii: could not export pack "${outcome.packName}". Open the Markii output for details.`;
  }
  const scriptClause = `webview.js is ${formatKb(outcome.scriptBytes)}`;
  const stylesheetClause =
    outcome.stylesheetBytes !== undefined
      ? ` and webview.css is ${formatKb(outcome.stylesheetBytes)}`
      : '';
  return `Markii: exported pack "${outcome.packName}" to ${outcome.destinationFolder}. ${scriptClause}${stylesheetClause}.`;
}

/**
 * The full detail for the Markii output channel: the other of a failure's
 * two homes (AGENTS.md's "clean is not silent"). A failure contributes its
 * reason VERBATIM, however long, since the popup deliberately omits it. A
 * success records where every artifact was written, so an author can find
 * them without guessing, plus any pack-CSS lint warnings the build
 * produced. A cancelled run records that nothing was written.
 */
export function packExportDiagnosticLines(
  outcome: PackExportOutcome,
): string[] {
  if (outcome.kind === 'cancelled') {
    return [
      `Export cancelled for pack "${outcome.packName}"; nothing was written.`,
    ];
  }
  if (outcome.kind === 'failed') {
    return [`Export failed for pack "${outcome.packName}": ${outcome.reason}`];
  }
  const lines = [
    `Exported pack "${outcome.packName}" to ${outcome.destinationFolder}: wrote ${outcome.manifestPath} (${String(outcome.manifestBytes)} bytes)`,
    `Exported pack "${outcome.packName}": wrote ${outcome.scriptPath} (${String(outcome.scriptBytes)} bytes)`,
  ];
  if (outcome.stylesheetPath !== undefined) {
    lines.push(
      `Exported pack "${outcome.packName}": wrote ${outcome.stylesheetPath} (${String(outcome.stylesheetBytes ?? 0)} bytes)`,
    );
  }
  if (outcome.removedStylesheetPath !== undefined) {
    lines.push(
      `Removed stale ${outcome.removedStylesheetPath}: this build produced no stylesheet.`,
    );
  }
  if (outcome.scriptFilesCopied > 0) {
    lines.push(
      `Exported pack "${outcome.packName}": copied ${String(outcome.scriptFilesCopied)} script file${outcome.scriptFilesCopied === 1 ? '' : 's'} from its scripts folder.`,
    );
  }
  lines.push(...outcome.warnings);
  return lines;
}

/** One item in the "which shape should this export take" quick pick, plain data, no `vscode.QuickPickItem` dependency. */
export interface PackExportFormatQuickPickItem {
  readonly label: string;
  readonly description: string;
  readonly format: 'folder' | 'archive';
}

/**
 * The two shapes "Markii: Export Pack" offers (GitHub issue #16): a folder
 * (today's default, still editable component sources alongside the built
 * output) or a single `.mkp` archive (for sharing, or for "Install Pack
 * from File" on another machine). `extension.ts` shows this quick pick
 * even when there is only one pack to export: the format choice is
 * independent of which pack.
 */
export const PACK_EXPORT_FORMAT_ITEMS: readonly PackExportFormatQuickPickItem[] =
  [
    {
      label: 'Folder',
      description: 'pack.json, webview.js, and scripts as separate files',
      format: 'folder',
    },
    {
      label: 'Pack archive (.mkp)',
      description: 'a single zipped file, for sharing or installing elsewhere',
      format: 'archive',
    },
  ];

/**
 * Writes `bytes` to `absolutePath`, creating any missing parent
 * directories first. The one raw-byte write this module needs: an archive
 * export writes exactly one file, so it goes straight to
 * `node:fs/promises`'s `writeFile` rather than composing several writes
 * through the text-oriented `PackExportFs` seam `exportPack`'s folder shape
 * uses.
 */
export async function writePackArchiveFile(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

/** Whether a file exists at `absolutePath`. Never throws. */
export async function archiveFileExists(
  absolutePath: string,
): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes the user-entered `.mkp` file name: trims whitespace and
 * appends the `.mkp` extension when the user left it off, so typing just
 * the pack's name still produces a valid file. Validation (empty, a path
 * separator, `.`/`..`) happens in `archiveExportNameValidationMessage`
 * below; this function assumes a name that already passed it.
 */
export function normalizeArchiveExportName(name: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith('.mkp') ? trimmed : `${trimmed}.mkp`;
}

/** The `validateInput` function for the `.mkp` file-name input box: the same unsafe-name rejections as `exportNameValidationMessage`, restated for a file rather than a folder. */
export function archiveExportNameValidationMessage(
  name: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Enter a file name.';
  }
  if (trimmed === '.' || trimmed === '..' || trimmed === '.mkp') {
    return 'Enter a plain file name.';
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'File name cannot contain a path separator.';
  }
  return undefined;
}

/** The overwrite-confirmation modal's wording for a `.mkp` file already at the chosen destination. */
export function packArchiveOverwriteConfirmMessage(request: {
  readonly packName: string;
  readonly fileName: string;
}): string {
  return `Markii: "${request.fileName}" already exists at the chosen destination. Overwrite it with this export of pack "${request.packName}"?`;
}

/**
 * The one result message for the archive export shape, covering every
 * `PackExportArchiveOutcome` kind plus the write step this module (not
 * `@markii/host`) performs. Matches `packExportResultMessage`'s wording
 * rules: at most two short sentences, no em dashes, no parentheses, and a
 * failure's reason stays out of the popup.
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

/** The full output-channel detail for one archive export attempt, mirroring `packExportDiagnosticLines`. */
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
