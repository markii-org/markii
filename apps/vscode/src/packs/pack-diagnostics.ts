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
 * VS Code setting) in the relative-entry note, since a relative
 * entry there resolves against whichever workspace happens to be open —
 * see `apps/obsidian/src/packs/pack-diagnostics.ts` for that host's own
 * wording of the same warning.
 *
 * The pack-registration validation itself (issue #3 slice 5) happens
 * inside the webview, a separate process, via `@markii/host/browser`'s
 * `buildRenderRegistry` (`../webview/pack-registry.ts`). Its outcome
 * (`invalidReasons`/`collisions`/`duplicateComposedNames`) crosses back to
 * this extension host over `postMessage` as a `PackDiagnosticsMessage`
 * (`../protocol.ts`, issue #20) and `formatPackRegistrationDiagnosticLines`
 * below turns it into the same lines this file already produces for
 * everything else, via the same shared formatter.
 */
import {
  formatPackDiagnosticLines as formatPackDiagnosticLinesShared,
  skippedPackCount as skippedPackCountShared,
} from '@markii/host';
import type { PackContext } from './pack-context.js';
import type { PackDiagnosticsMessage } from '../protocol.js';

/** ITEM 4's wording, softened to informational (docs/packs.md: "a host notes relative entries in its diagnostics"): naming `markii.packs` as the user-scoped setting the entry sits in. */
function relativeEntryLine(entry: string): string {
  return `markii.packs entry "${entry}" is workspace-relative: it loads from inside whichever workspace is open (markii.packs is a user-scoped setting), so each workspace supplies (or lacks) its own copy. Use an absolute or "~/..." path for one shared folder across workspaces.`;
}

/**
 * Issue #15, gap 2's wording (reworded for issue #16's Export Pack
 * command): informs, never warns, that a pack's prebuilt `webview.js` is
 * what actually loaded and its sibling component sources were not
 * compiled. Names this host's own export command (`markii.exportPack`) so
 * the note is actionable. Output channel only — never a window
 * notification, and never counted toward `skippedPackCount` (see
 * `PackContext.prebuiltShadowedPacks`'s doc comment): shipping both is a
 * supported state, not a failure.
 */
function prebuiltShadowLine(pack: { name: string; folder: string }): string {
  return `Pack "${pack.name}" is using its prebuilt webview.js, so the component sources in that folder are not compiled. Edits to them take effect only after you delete webview.js or export the pack again with Markii: Export Pack.`;
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
    relativeEntryLines: context.relativeEntries.map(relativeEntryLine),
    prebuiltShadowLines: context.prebuiltShadowedPacks.map(prebuiltShadowLine),
    cssWarnings: context.cssWarnings,
  });
}

/** How many configured folders failed to produce a usable pack — what the preview's quiet marker counts (`webview/preview.tsx`). */
export function skippedPackCount(context: PackContext): number {
  return skippedPackCountShared(context);
}

/**
 * Formats one `PackDiagnosticsMessage` the webview sent (issue #20) as
 * plain text lines for the Markii output channel, reusing the exact same
 * shared formatting path as `formatPackDiagnosticLines` above — an empty
 * `packs`/`skipped`/`cssWarnings` context contributes nothing, so only the
 * registration-related lines this message actually carries come out.
 */
export function formatPackRegistrationDiagnosticLines(
  message: Pick<
    PackDiagnosticsMessage,
    'invalidReasons' | 'collisions' | 'duplicateComposedNames'
  >,
): string[] {
  return formatPackDiagnosticLinesShared({
    packs: [],
    skipped: [],
    cssWarnings: [],
    invalidRegistrationReasons: message.invalidReasons,
    registrationCollisions: message.collisions,
    duplicateComposedNames: message.duplicateComposedNames,
  });
}
