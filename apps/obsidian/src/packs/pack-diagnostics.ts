/**
 * Formats a `PackContext` (`./pack-context.ts`) as plain text lines for this
 * plugin's diagnostics surface — the "Show Markii diagnostics" command
 * (`../main.ts`) prints these to the developer console, per AGENTS.md's
 * cleanliness principle: "every failure needs a full diagnostic somewhere a
 * user can find it, not just a quiet marker in the preview." Obsidian has no
 * output-channel API, so `console` is that "somewhere" — see `../main.ts`.
 *
 * The structural wording (one line per loaded pack, one per skipped
 * folder, the CSS-warning lines, invalid-registration reasons, and the
 * namespace-collision line) is shared across every host and lives in
 * `@markii/host`'s `formatPackDiagnosticLines`. This file's own job is
 * just the ONE piece that is genuinely Obsidian-specific: naming this
 * plugin's device-local pack-folder list in the deprecated-relative-entry
 * line, since a relative entry there resolves against whichever vault
 * happens to be open — see `apps/vscode/src/packs/pack-diagnostics.ts` for
 * that host's own wording of the same warning.
 */
import {
  formatPackDiagnosticLines as formatPackDiagnosticLinesShared,
  skippedPackCount as skippedPackCountShared,
} from '@markii/host';
import type { PackContext } from './pack-context.js';

/** One line for each pack-folder entry that is relative — a device-local Obsidian install can open several vaults, and a relative entry resolves against whichever vault happens to be open, meaning a different folder per vault. Never blocks the entry from loading; a deprecation warning only. */
function deprecatedEntryLine(entry: string): string {
  return `Deprecated: pack folder entry "${entry}" is relative, so it resolves to a different folder in every vault you open it in. Prefer an absolute path, or a "~/..." path.`;
}

/**
 * The full set of diagnostic lines for one `loadPackContext` result, loaded
 * packs first (the confirmation that the setting is working at all), then
 * every skipped folder, then deprecated relative entries, then any pack CSS
 * lint warnings, then any invalid-registration or namespace-collision lines
 * the render-registry step recorded (`@markii/host`'s `buildRenderRegistry`).
 */
export function formatPackDiagnosticLines(context: PackContext): string[] {
  return formatPackDiagnosticLinesShared({
    packs: context.packs,
    skipped: context.skipped,
    deprecatedEntryLines:
      context.deprecatedRelativeEntries.map(deprecatedEntryLine),
    cssWarnings: context.cssWarnings,
    invalidRegistrationReasons: context.invalidRegistrationReasons,
    registrationCollisions: context.registrationCollisions,
  });
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts. */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}
