/**
 * Formats a `PackContext` (`./pack-context.ts`) as plain text lines for the
 * host's diagnostics surface (AGENTS.md's "clean is not silent": every
 * failure needs a full diagnostic somewhere a user can find it, not just a
 * quiet marker in the preview). `vscode`-free — `preview-panel.ts` owns the
 * actual `vscode.OutputChannel` and just writes these lines to it, which is
 * what keeps this module testable with vitest.
 *
 * The structural wording (one line per loaded pack, one per skipped
 * folder, the CSS-warning lines, and any pack-registration lines) is
 * shared across every host and lives in `@markii/host`'s
 * `formatPackDiagnosticLines`. This file's own job is just the ONE piece
 * that is genuinely VS-Code-specific: naming `markii.packs` (a user-scoped
 * VS Code setting) in the deprecated-relative-entry line, since a relative
 * entry there resolves against whichever workspace happens to be open —
 * see `apps/obsidian/src/packs/pack-diagnostics.ts` for that host's own
 * wording of the same warning.
 *
 * VS Code does not currently supply `invalidRegistrationReasons` /
 * `registrationCollisions` (the pack-registration validation happens
 * inside the webview, a separate process — see `../webview/pack-registry.ts`),
 * so those are simply omitted here; `@markii/host`'s formatter already
 * treats them as optional and contributes nothing when absent, so this is
 * not a behavior change.
 */
import {
  formatPackDiagnosticLines as formatPackDiagnosticLinesShared,
  skippedPackCount as skippedPackCountShared,
} from '@markii/host';
import type { PackContext } from './pack-context.js';

/** ITEM 4's wording: naming `markii.packs` as the offending, user-scoped setting. */
function deprecatedEntryLine(entry: string): string {
  return `Deprecated: markii.packs entry "${entry}" is relative, so it resolves to a different folder in every workspace (markii.packs is a user-scoped setting). Prefer an absolute path, or a "~/..." path.`;
}

/**
 * The full set of diagnostic lines for one `loadPackContext` result, loaded
 * packs first (the confirmation that the setting is working at all) then
 * every skipped folder with its reason. Empty when nothing is configured at
 * all — the caller decides whether an empty result is worth writing
 * anything to the channel (see `preview-panel.ts`'s `logPackDiagnostics`).
 */
export function formatPackDiagnosticLines(context: PackContext): string[] {
  return formatPackDiagnosticLinesShared({
    packs: context.packs,
    skipped: context.skipped,
    deprecatedEntryLines:
      context.deprecatedRelativeEntries.map(deprecatedEntryLine),
    cssWarnings: context.cssWarnings,
  });
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts (`webview/preview.tsx`). */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}
