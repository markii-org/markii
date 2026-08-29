/**
 * Formats a host's pack-loading outcome as plain text lines for that host's
 * own diagnostics surface (AGENTS.md's "clean is not silent": every
 * failure needs a full diagnostic somewhere a user can find it, not just a
 * quiet marker in the preview).
 *
 * This module owns the STRUCTURAL wording — one line per loaded pack, one
 * per skipped folder, the CSS-warning lines, and the pack-registration
 * lines (invalid registration reasons and the namespace-collision line) —
 * which is identical across every host. It deliberately does NOT format
 * the relative-entry note or the prebuilt-shadow note: which setting a
 * relative entry belongs to (VS Code's `markii.packs`, this plugin's
 * device-local pack-folder list) and what "relative" means for that host (a
 * different workspace window vs. a different vault) is host-specific
 * knowledge, and naming a host's own "build pack for distribution" command
 * in the shadow note is host-specific the same way, so each host formats
 * those lines itself and passes them in already-rendered
 * (`relativeEntryLines`/`prebuiltShadowLines` below) — see
 * `apps/vscode/src/packs/pack-diagnostics.ts` and
 * `apps/obsidian/src/packs/pack-diagnostics.ts` for each host's own wording
 * and thin wrapper around this function.
 */

/** The minimal shape of one loaded pack this module needs — a structural subset of `./discover.ts`'s `DiscoveredPack`. */
export interface PackDiagnosticsPack {
  readonly manifest: {
    readonly name: string;
    readonly components: Readonly<Record<string, unknown>>;
  };
}

/** The minimal shape of one skipped folder this module needs — a structural subset of `./discover.ts`'s `SkippedPackFolder`. */
export interface PackDiagnosticsSkippedFolder {
  readonly folder: string;
  readonly reason: string;
}

export interface PackDiagnosticsContext {
  /** Every validated, non-colliding discovered pack. */
  readonly packs: readonly PackDiagnosticsPack[];
  /** Configured folders that produced no usable pack, and why. */
  readonly skipped: readonly PackDiagnosticsSkippedFolder[];
  /** Already-formatted lines, one per relative pack-folder-setting entry (host-specific wording — see this module's top doc comment). Defaults to none. */
  readonly relativeEntryLines?: readonly string[];
  /** Already-formatted informational lines, one per pack whose prebuilt webview.js shadows component sources on disk (host-specific wording, since each host names its own build command). Informational, never a failure: shipping both is a supported state. */
  readonly prebuiltShadowLines?: readonly string[];
  /** Pack CSS authoring warnings against every built pack's emitted stylesheet. Warnings only, developer-facing. */
  readonly cssWarnings: readonly string[];
  /** One line per malformed pack registration, dropped rather than installed (`./pack-render-registry.ts`'s `BuildRenderRegistryResult.invalidReasons`). Omitted (or empty) contributes nothing — a host that never validates registrations on this side (e.g. VS Code's webview validates them separately, in the browser) simply has none to report yet. */
  readonly invalidRegistrationReasons?: readonly string[];
  /** Namespaces shared by two or more registered packs (`./pack-render-registry.ts`'s `BuildRenderRegistryResult.collisions`). When non-empty, contributes one summary line. */
  readonly registrationCollisions?: readonly string[];
}

/** One line for each folder `discoverPacks`/a host's `loadPackContext` could not turn into a usable pack. */
function skippedLines(context: PackDiagnosticsContext): string[] {
  return context.skipped.map(
    (entry) => `Skipped pack folder "${entry.folder}": ${entry.reason}`,
  );
}

/** One line for each pack that loaded successfully, naming what a user would want to confirm: its name, namespace, and how many components it registered. */
function loadedLines(context: PackDiagnosticsContext): string[] {
  return context.packs.map((pack) => {
    const componentCount = Object.keys(pack.manifest.components).length;
    const plural = componentCount === 1 ? 'component' : 'components';
    return `Loaded pack "${pack.manifest.name}" (namespace: ${pack.manifest.name}, ${String(componentCount)} ${plural})`;
  });
}

/** The one summary line for a namespace collision among registered packs, or `[]` when there was none. */
function collisionLines(context: PackDiagnosticsContext): string[] {
  const collisions = context.registrationCollisions ?? [];
  if (collisions.length === 0) return [];
  return [
    `Installed packs share a namespace (${collisions.join(', ')}); none of them were installed.`,
  ];
}

/**
 * The full set of diagnostic lines for one pack-loading outcome: loaded
 * packs first (the confirmation that the setting is working at all), then
 * every skipped folder with its reason, then relative-entry lines, then
 * prebuilt-shadow lines, then pack CSS lint warnings, then any
 * invalid-registration or namespace-collision lines. Empty when nothing is
 * configured at all — the caller decides whether an empty result is worth
 * writing anything to its own diagnostics surface.
 */
export function formatPackDiagnosticLines(
  context: PackDiagnosticsContext,
): string[] {
  return [
    ...loadedLines(context),
    ...skippedLines(context),
    ...(context.relativeEntryLines ?? []),
    ...(context.prebuiltShadowLines ?? []),
    ...context.cssWarnings,
    ...(context.invalidRegistrationReasons ?? []),
    ...collisionLines(context),
  ];
}

/** How many configured folders failed to produce a usable pack — what a preview's quiet marker counts. */
export function skippedPackCount(context: {
  readonly skipped: readonly PackDiagnosticsSkippedFolder[];
}): number {
  return context.skipped.length;
}
