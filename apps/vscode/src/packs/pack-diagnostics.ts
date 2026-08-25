/**
 * Formats a `PackContext` (`./pack-context.ts`) as plain text lines for the
 * host's diagnostics surface (AGENTS.md's "clean is not silent": every
 * failure needs a full diagnostic somewhere a user can find it, not just a
 * quiet marker in the preview). `vscode`-free — `preview-panel.ts` owns the
 * actual `vscode.OutputChannel` and just writes these lines to it, which is
 * what keeps this module testable with vitest.
 *
 * Two kinds of line: one per configured folder that failed to produce a
 * usable pack (`skipped`, already carrying its own reason from
 * `discoverPacks`/`loadPackContext`), and one per pack that DID load, so a
 * working setup is just as confirmable as a broken one — silence either way
 * would leave a user guessing whether the setting was even read.
 */
import type { PackContext } from './pack-context.js';

/** One "Markii" line for each folder `discoverPacks`/`loadPackContext` could not turn into a usable pack. */
function skippedLines(context: PackContext): string[] {
  return context.skipped.map(
    (entry) => `Skipped pack folder "${entry.folder}": ${entry.reason}`,
  );
}

/**
 * ITEM 4: one "Markii" line per `markii.packs` entry that is relative
 * (`./resolve-pack-paths.ts`'s `relativePackEntries`), naming the entry and
 * explaining why it is worth fixing — `markii.packs` is a USER-scoped
 * setting, so a relative entry resolves against whatever workspace happens
 * to be open, meaning a different folder per window. This never blocks the
 * entry from loading; it is a deprecation warning only.
 */
function deprecatedRelativeEntryLines(context: PackContext): string[] {
  return context.deprecatedRelativeEntries.map(
    (entry) =>
      `Deprecated: markii.packs entry "${entry}" is relative, so it resolves to a different folder in every workspace (markii.packs is a user-scoped setting). Prefer an absolute path, or a "~/..." path.`,
  );
}

/** One "Markii" line for each pack that loaded successfully, naming what a user would want to confirm: its name, namespace, and how many components it registered. */
function loadedLines(context: PackContext): string[] {
  return context.packs.map((pack) => {
    const componentCount = Object.keys(pack.manifest.components).length;
    const plural = componentCount === 1 ? 'component' : 'components';
    return `Loaded pack "${pack.manifest.name}" (namespace: ${pack.manifest.name}, ${componentCount} ${plural})`;
  });
}

/**
 * The full set of diagnostic lines for one `loadPackContext` result, loaded
 * packs first (the confirmation that the setting is working at all) then
 * every skipped folder with its reason. Empty when nothing is configured at
 * all — the caller decides whether an empty result is worth writing
 * anything to the channel (see `preview-panel.ts`'s `logPackDiagnostics`).
 */
export function formatPackDiagnosticLines(context: PackContext): string[] {
  return [
    ...loadedLines(context),
    ...skippedLines(context),
    ...deprecatedRelativeEntryLines(context),
    ...context.cssWarnings,
  ];
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts (`webview/preview.tsx`). */
export function skippedPackCount(context: PackContext): number {
  return context.skipped.length;
}
