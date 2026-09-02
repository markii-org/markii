/**
 * Formats a `PackContext` (`./pack-context.ts`) as plain text lines for this
 * plugin's diagnostics surface — the "Show Markii diagnostics" command
 * (`../main.ts`) prints these to the developer console, per AGENTS.md's
 * cleanliness principle: "every failure needs a full diagnostic somewhere a
 * user can find it, not just a quiet marker in the preview." Obsidian has no
 * output-channel API, so `console` is that "somewhere" — see `../main.ts`.
 *
 * The structural wording (one line per loaded pack, one per skipped
 * folder, invalid-registration reasons, and the namespace-collision line)
 * is shared across every host and lives in `@markii/host`'s
 * `formatPackDiagnosticLines`. This file's own job is the pieces that are
 * genuinely Obsidian-specific: the wording of the prebuilt-shadow note,
 * the "present but not enabled" note, and the notice-level wording for a
 * pack-load or namespace-collision failure.
 *
 * The prebuilt-shadow note is INFORMATIONAL: a pack folder that holds both
 * a prebuilt `webview.js` and component sources is a defense-in-depth
 * report, never a failure, for a folder a user placed by hand outside the
 * install command — every pack this plugin installs itself ships only the
 * prebuilt form. This plugin has no build command of its own (AGENTS.md's
 * Host positioning: VS Code is the authoring host and owns pack
 * packaging), so the note points at VS Code's Export Pack command, which is
 * how a user would refresh a prebuilt script after editing its sources
 * elsewhere.
 */
import {
  formatPackDiagnosticLines as formatPackDiagnosticLinesShared,
  skippedPackCount as skippedPackCountShared,
} from '@markii/host';
import type { PackContext } from './pack-context.js';

/**
 * One informational line for a pack whose prebuilt `webview.js` shadows
 * component sources still present in the same folder (`@markii/host`'s
 * `resolvePrebuiltPack`). Never a failure: shipping both the built
 * artifact and its sources is a supported distribution shape.
 */
function prebuiltShadowLine(pack: {
  readonly name: string;
  readonly folder: string;
}): string {
  return `Pack "${pack.name}" is using its prebuilt webview.js, so the component sources in that folder are not compiled. Edits to them take effect only after you delete webview.js, or rebuild it with the VS Code Export Pack command.`;
}

/** One line per namespace present on disk under `packs/` but not on this device's trust list — `../packs/installed-packs.ts`'s `selectLoadablePackFolders`. Informational, not a failure: the settings tab's "Enable" control is the way to load it. */
export function notEnabledPackLine(namespace: string): string {
  return `Pack "${namespace}" is present but not enabled on this device. Enable it in Markii's settings, under "Component packs", to load it.`;
}

/**
 * The full set of diagnostic lines for one `loadPackContext` result, loaded
 * packs first (the confirmation that installed packs are actually being
 * read), then every skipped folder, then any prebuilt-shadow note, then
 * any invalid-registration, namespace-collision, or duplicate-composed-name
 * lines the render-registry step recorded (`@markii/host`'s
 * `buildRenderRegistry`).
 */
export function formatPackDiagnosticLines(context: PackContext): string[] {
  return formatPackDiagnosticLinesShared({
    packs: context.packs,
    skipped: context.skipped,
    relativeEntryLines: [],
    prebuiltShadowLines: context.prebuiltShadowedPacks.map(prebuiltShadowLine),
    cssWarnings: [],
    invalidRegistrationReasons: context.invalidRegistrationReasons,
    registrationCollisions: context.registrationCollisions,
    duplicateComposedNames: context.duplicateComposedNames,
  });
}

/** How many installed packs failed to produce a usable pack — what the preview's quiet marker counts. */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}

/** The generic pack-failure `Notice` for `count` skips. Notice style (user-set 2026-08-29): a notice is at most two short sentences, first what went wrong, then what to do about it. No em dashes, no parentheses, no quoted command names; the full detail lives in the console via the diagnostic lines, not in the notice. */
export function packLoadFailureNotice(count: number): string {
  const packs = count === 1 ? 'a pack' : `${String(count)} packs`;
  return `Markii: ${packs} failed to load. Open the Markii diagnostics for details.`;
}

/** The `Notice` after a pack is removed. Same notice style. */
export function packRemovedNotice(namespace: string): string {
  return `Markii: removed the pack ${namespace}. Markii packs reloaded.`;
}

/** The `Notice` when a removed pack's trust entry is gone but its folder could not be deleted. The pack no longer loads either way; the folder is what is left behind, and the console line says which path it is. */
export function packRemoveFolderFailedNotice(namespace: string): string {
  return `Markii: the pack ${namespace} no longer loads, but its folder could not be deleted. Open the Markii diagnostics for the path.`;
}

/** The `Notice` after a present-but-not-enabled pack is enabled. Same notice style. */
export function packEnabledNotice(namespace: string): string {
  return `Markii: enabled the pack ${namespace}. Markii packs reloaded.`;
}

/** The namespace-collision `Notice`. Same notice style. */
export function packCollisionNotice(namespaces: readonly string[]): string {
  return `Markii: packs share the name ${namespaces.join(', ')}. None of them were loaded.`;
}
