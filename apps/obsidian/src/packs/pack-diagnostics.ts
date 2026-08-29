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
 * `@markii/host`'s `formatPackDiagnosticLines`. This file's own job is the
 * pieces that are genuinely Obsidian-specific: the wording of the
 * relative-entry note, and the wording of the prebuilt-shadow note.
 *
 * The relative-entry note is INFORMATIONAL: an Obsidian vault is a
 * self-contained world, so "./packs" meaning "this vault's own packs
 * folder" is a spelling a user may want on purpose — the note only states
 * the per-vault consequence. (VS Code's own wording names its user-scoped
 * `markii.packs` setting — see `apps/vscode/src/packs/pack-diagnostics.ts`.)
 *
 * The prebuilt-shadow note is also INFORMATIONAL (issue #15, reworded for
 * issue #16): a pack folder that holds both a prebuilt `webview.js` and its
 * component sources is a supported shape, never a failure. This plugin no
 * longer builds packs itself (VS Code is the authoring host and owns pack
 * packaging), so the note points at the VS Code Export Pack command rather
 * than treating the situation as something to fix here.
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
 * One informational line for a pack whose prebuilt `webview.js` shadows
 * component sources still present in the same folder (`@markii/host`'s
 * `resolvePrebuiltPack`, issue #15). Never a failure: shipping both the
 * built artifact and its sources is a supported distribution shape. This
 * plugin has no build command of its own (issue #16: VS Code is the
 * authoring host and owns pack packaging), so this line points at VS
 * Code's Export Pack command since that is how a user would refresh the
 * prebuilt script after editing the sources.
 */
function prebuiltShadowLine(pack: {
  readonly name: string;
  readonly folder: string;
}): string {
  return `Pack "${pack.name}" is using its prebuilt webview.js, so the component sources in that folder are not compiled. Edits to them take effect only after you delete webview.js, or rebuild it with the VS Code Export Pack command.`;
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
 * reason. Notice style (user-set 2026-08-29): a notice is at most two
 * short sentences, first what went wrong, then what to do about it. No
 * em dashes, no parentheses, no quoted command names; the full detail
 * lives in the console via the diagnostic lines, not in the notice.
 */
export const PACK_COMPILATION_UNAVAILABLE_NOTICE =
  'Markii: a pack needs building, but this install cannot build packs. ' +
  'Install the full zip release to use it.';

/** How many skipped entries carry the "no compiler installed" reason, so `view.tsx`'s `notifyPackFailures` can report those with `PACK_COMPILATION_UNAVAILABLE_NOTICE` and only the remainder with the generic failure notice, instead of double-reporting the same pack. Matches the stable marker substring rather than the full sentence so a wording change to `packCompilationUnavailableReason` can never silently break this check. */
export function compilationUnavailableSkipCount(context: {
  readonly skipped: readonly { readonly reason: string }[];
}): number {
  return context.skipped.filter((entry) =>
    entry.reason.includes(PACK_COMPILATION_UNAVAILABLE_MARKER),
  ).length;
}

/** Backwards-compatible predicate over `compilationUnavailableSkipCount`. */
export function hasPackCompilationUnavailable(context: {
  readonly skipped: readonly { readonly reason: string }[];
}): boolean {
  return compilationUnavailableSkipCount(context) > 0;
}

/** The generic pack-failure `Notice` for `count` skips that are NOT the no-compiler case above. Same notice style: what went wrong, where the detail is. */
export function packLoadFailureNotice(count: number): string {
  const packs = count === 1 ? 'a pack' : `${String(count)} packs`;
  return `Markii: ${packs} failed to load. Open the Markii diagnostics for details.`;
}

/** The namespace-collision `Notice`. Same notice style. */
export function packCollisionNotice(namespaces: readonly string[]): string {
  return `Markii: packs share the name ${namespaces.join(', ')}. None of them were loaded.`;
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
    prebuiltShadowLines: context.prebuiltShadowedPacks.map(prebuiltShadowLine),
    cssWarnings: context.cssWarnings,
    invalidRegistrationReasons: context.invalidRegistrationReasons,
    registrationCollisions: context.registrationCollisions,
  });
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts. */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}
