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
 * just the ONE piece that is genuinely Obsidian-specific: the wording of
 * the relative-entry note. It is INFORMATIONAL: an Obsidian vault is a
 * self-contained world, so "./packs" meaning "this vault's own packs
 * folder" is a spelling a user may want on purpose — the note only states
 * the per-vault consequence. (VS Code's own wording names its user-scoped
 * `markii.packs` setting — see `apps/vscode/src/packs/pack-diagnostics.ts`.)
 */
import {
  formatPackDiagnosticLines as formatPackDiagnosticLinesShared,
  skippedPackCount as skippedPackCountShared,
} from '@markii/host';
import type { PackContext } from './pack-context.js';

/** One line for each pack-folder entry that is relative. Informational, never a warning: vault-relative packs are a supported spelling (a pack that lives inside the vault it serves), but since this plugin's folder list is device-local while the vault changes, the fact that the SAME entry loads a DIFFERENT folder per vault is worth stating where a user debugging a pack will look. */
function relativeEntryLine(entry: string): string {
  return `pack folder "${entry}" is vault-relative: it loads from inside whichever vault is open, so each vault supplies (or lacks) its own copy. Use an absolute or "~/..." path for one shared folder across vaults.`;
}

/**
 * Stable marker embedded in `packCompilationUnavailableReason`'s sentence.
 * `hasPackCompilationUnavailable` matches against this substring rather than
 * re-deriving the whole sentence, so the wording can be reworded (or
 * translated) without breaking the predicate that `view.tsx` uses to decide
 * whether to show `PACK_COMPILATION_UNAVAILABLE_NOTICE`.
 */
const PACK_COMPILATION_UNAVAILABLE_MARKER =
  'compiling a pack from source needs files';

/**
 * The `skipped` reason recorded (`./pack-context.ts`'s `resolveCompiledPacks`,
 * via `./pack-compilation.ts`) when a pack has no prebuilt `webview.js` and
 * needs compiling, but the esbuild-wasm runtime is not installed beside
 * `main.js`. This lives here rather than inline at the call site because
 * AGENTS.md makes failure wording the ONE responsibility of this module: a
 * three-file (manifest.json/main.js/styles.css) install genuinely cannot
 * compile a pack from source (that ~14 MB runtime only ships in the full
 * zip), and per AGENTS.md's "clean is not silent" rule that missing
 * capability still needs a plain, locatable explanation rather than a raw
 * esbuild error surfacing through `skipped`.
 */
export function packCompilationUnavailableReason(packName: string): string {
  return (
    `pack "${packName}" was not compiled: ${PACK_COMPILATION_UNAVAILABLE_MARKER} ` +
    'that only the full zip install includes. Download the zip from ' +
    'https://github.com/markii-org/markii-obsidian/releases instead of ' +
    'installing from the loose manifest.json/main.js/styles.css. A pack ' +
    'that ships a prebuilt "webview.js" still loads without this.'
  );
}

/**
 * The short `Notice` text for the same condition (see
 * `packCompilationUnavailableReason` above), shown once per preview open
 * from `view.tsx`'s `notifyPackFailures` alongside its other pack-failure
 * notices. Kept here, not inline, for the same single-home-for-wording
 * reason: the full explanation lives in the console via
 * `packCompilationUnavailableReason`, and this is only the pointer to it.
 */
export const PACK_COMPILATION_UNAVAILABLE_NOTICE =
  'Markii: a component pack needs compiling but this install has no ' +
  'compiler (only the zip install does) — see the developer console ' +
  '("Show Markii diagnostics") for details.';

/**
 * Whether `context.skipped` carries the "no compiler installed" reason
 * above, for `view.tsx`'s `notifyPackFailures` to decide whether to show
 * `PACK_COMPILATION_UNAVAILABLE_NOTICE`. Matches on the stable marker
 * substring rather than the full sentence so a wording change to
 * `packCompilationUnavailableReason` can never silently break this check.
 */
export function hasPackCompilationUnavailable(context: {
  readonly skipped: readonly { readonly reason: string }[];
}): boolean {
  return context.skipped.some((entry) =>
    entry.reason.includes(PACK_COMPILATION_UNAVAILABLE_MARKER),
  );
}

/**
 * The full set of diagnostic lines for one `loadPackContext` result, loaded
 * packs first (the confirmation that the setting is working at all), then
 * every skipped folder, then relative-entry notes, then any pack CSS
 * lint warnings, then any invalid-registration or namespace-collision lines
 * the render-registry step recorded (`@markii/host`'s `buildRenderRegistry`).
 */
export function formatPackDiagnosticLines(context: PackContext): string[] {
  return formatPackDiagnosticLinesShared({
    packs: context.packs,
    skipped: context.skipped,
    relativeEntryLines: context.relativeEntries.map(relativeEntryLine),
    cssWarnings: context.cssWarnings,
    invalidRegistrationReasons: context.invalidRegistrationReasons,
    registrationCollisions: context.registrationCollisions,
  });
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts. */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}
