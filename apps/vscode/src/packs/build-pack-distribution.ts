/**
 * `vscode`-free logic behind the `markii.buildPackForDistribution` command
 * (GitHub issue #15, gap 3): compiles a configured pack's `.tsx` sources
 * and writes `webview.js` (and `webview.css`, when the build emits one)
 * into the pack's OWN folder, turning it into the prebuilt shape
 * docs/packs.md's "Two ways to run a pack" describes as the form to ship.
 *
 * This module owns everything worth unit-testing: discovering the packs
 * the command can offer (a small, dedicated function — `./pack-context.ts`'s
 * `loadPackContext` also discovers packs, but it additionally loads Lua
 * modules and resolves/compiles webview scripts for the PREVIEW path, which
 * this command has no use for), a plain `node:fs/promises`-backed
 * `PackDistributionFs` for `@markii/host`'s `buildPackForDistribution`, the
 * quick-pick item shape (plain data, no `vscode.QuickPickItem` import), and
 * every user-facing string the command produces — this is that string's
 * one home, matching how `./pack-diagnostics.ts` owns this host's
 * diagnostic wording. `extension.ts` (which already imports `vscode`) is
 * wiring only: it discovers packs via this module, offers a quick pick when
 * there is more than one, calls `@markii/host`'s `buildPackForDistribution`
 * with this module's `PackDistributionFs`, and shows the message this
 * module renders.
 */
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  createNodeFileReader,
  discoverPacks,
  resolvePackPaths,
} from '@markii/host';
import type {
  DiscoveredPack,
  PackDistributionFs,
  PackDistributionOutcome,
} from '@markii/host';

/**
 * Every discovered pack `markii.packs` currently names — what the command
 * offers to build. Deliberately not `./pack-context.ts`'s `loadPackContext`:
 * that function also loads Lua modules and resolves/compiles a webview
 * registration script for the PREVIEW path, neither of which this command
 * needs, so contorting it to serve both callers would just make it harder
 * to read for no benefit here.
 */
export async function discoverConfiguredPacksForDistribution(
  configuredPacks: readonly string[],
  workspaceRoot: string | undefined,
): Promise<readonly DiscoveredPack[]> {
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredPacks, workspaceRoot, homeDir);
  const result = await discoverPacks(folders, createNodeFileReader());
  return result.packs;
}

/**
 * A Node-backed `PackDistributionFs`. `exists`/`readFile` never throw (a
 * missing or unreadable path just resolves the "absent" value, matching
 * `@markii/host`'s other filesystem seams); `writeFile`/`deleteFile` may
 * reject, exactly as `@markii/host`'s `buildPackForDistribution` expects —
 * it wraps those two calls itself and turns a rejection into a `'failed'`
 * outcome rather than throwing.
 */
export function createNodePackDistributionFs(): PackDistributionFs {
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
  };
}

/**
 * The quick-pick item shape for one discovered pack, as plain data — no
 * `vscode.QuickPickItem` dependency. `extension.ts` builds this list in the
 * same order as the packs it discovered, so the index of the chosen item
 * recovers the matching `DiscoveredPack`.
 */
export interface PackDistributionQuickPickItem {
  readonly label: string;
  readonly description: string;
}

/** `label` is the pack's own name; `description` is the folder it was discovered in, so two same-named packs (which cannot both be installed, but could both be configured before a namespace collision is detected) are still distinguishable in the picker. */
export function packDistributionQuickPickItem(
  pack: DiscoveredPack,
): PackDistributionQuickPickItem {
  return { label: pack.manifest.name, description: pack.folder };
}

/** Rounds a byte count up to whole kilobytes, with a floor of 1 KB — a build under 1024 bytes should never read as "0 KB". */
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** Shown when `markii.packs` names no folders at all — there is nothing for the command to offer. */
export const NO_PACKS_CONFIGURED_MESSAGE =
  'Markii: no pack folders are configured. Add one with Markii: Add Pack Folder, then run this command again.';

/** The overwrite-confirmation modal's wording, for when the pack's folder already has a prebuilt `webview.js`/`webview.css` this build would replace. */
export function packOverwriteConfirmMessage(request: {
  readonly packName: string;
  readonly existingPaths: readonly string[];
}): string {
  const single = request.existingPaths.length === 1;
  const noun = single ? 'a prebuilt file' : 'prebuilt files';
  const pronoun = single ? 'it' : 'them';
  return `Markii: pack "${request.packName}" already has ${noun} in its folder. Overwrite ${pronoun}?`;
}

/**
 * The one result message for the command, covering every
 * `PackDistributionOutcome` kind. A success names both written files and
 * their sizes; the stylesheet clause is dropped when the build produced
 * none. At most two short sentences, matching this host's wording rules:
 * no em dashes, no parentheses.
 */
export function packDistributionResultMessage(
  outcome: PackDistributionOutcome,
): string {
  if (outcome.kind === 'cancelled') {
    return `Markii: build cancelled for pack "${outcome.packName}". Nothing was written.`;
  }
  if (outcome.kind === 'failed') {
    // The REASON deliberately does not go in the popup: a build failure's
    // reason is often a multi-line compiler error, and AGENTS.md's
    // cleanliness rule keeps an error dump out of the quiet marker. It
    // reaches the other of a failure's two homes instead, verbatim, via
    // `packDistributionDiagnosticLines` and the Markii output channel.
    return `Markii: could not build pack "${outcome.packName}". Open the Markii output for details.`;
  }
  const scriptClause = `webview.js is ${formatKb(outcome.scriptBytes)}`;
  const stylesheetClause =
    outcome.stylesheetBytes !== undefined
      ? ` and webview.css is ${formatKb(outcome.stylesheetBytes)}`
      : '';
  return `Markii: built pack "${outcome.packName}" into its folder. ${scriptClause}${stylesheetClause}.`;
}

/**
 * The full detail for the Markii output channel: the other of a failure's
 * two homes (AGENTS.md's "clean is not silent"). A failure contributes its
 * reason VERBATIM, however long, since the popup deliberately omits it. A
 * success records where the artifacts were written, so an author can find
 * them without guessing, plus any pack-CSS lint warnings the build
 * produced. A cancelled run records that nothing was written.
 */
export function packDistributionDiagnosticLines(
  outcome: PackDistributionOutcome,
): string[] {
  if (outcome.kind === 'cancelled') {
    return [
      `Build for distribution cancelled for pack "${outcome.packName}"; nothing was written.`,
    ];
  }
  if (outcome.kind === 'failed') {
    return [
      `Build for distribution failed for pack "${outcome.packName}": ${outcome.reason}`,
    ];
  }
  const lines = [
    `Built pack "${outcome.packName}" for distribution: wrote ${outcome.scriptPath} (${String(outcome.scriptBytes)} bytes)`,
  ];
  if (outcome.stylesheetPath !== undefined) {
    lines.push(
      `Built pack "${outcome.packName}" for distribution: wrote ${outcome.stylesheetPath} (${String(outcome.stylesheetBytes ?? 0)} bytes)`,
    );
  }
  if (outcome.removedStylesheetPath !== undefined) {
    lines.push(
      `Removed stale ${outcome.removedStylesheetPath}: this build produced no stylesheet.`,
    );
  }
  lines.push(...outcome.warnings);
  return lines;
}
