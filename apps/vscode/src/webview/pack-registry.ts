/**
 * The webview half of the pack registration convention (GitHub issue #3
 * slice 5, docs/packs.md): reads whatever `window.__markiiPackRegistrations`
 * collected (see `../webview-html.ts`'s doc comment for the full convention
 * and load order) and merges every validated entry into the render registry.
 *
 * ISSUE #20: this used to hand-duplicate `@markii/host`'s per-entry
 * validation (`isPackComponentModules`/`toPackToInstall`) and its merge
 * (via `@markii/react`'s `installPacks`, last-wins on a composed-name
 * collision) because this webview bundle could not import `@markii/host` as
 * a value at all — `esbuild.config.mjs`'s `webviewBuild` is
 * `platform: 'browser'`/`format: 'iife'` with NO `external` entries (VS
 * Code's webview CSP forbids a module graph fetched at runtime), and
 * `@markii/host`'s package export was one barrel (`src/index.ts`) pulling in
 * the whole Node-heavy Run/pack-build module graph (`node:fs`,
 * `node:worker_threads`, ...), which broke this bundle even for a single
 * pure function.
 *
 * That is fixed now: `@markii/host/browser` (`packages/markii-host/src/
 * browser.ts`) is a second, environment-free entry point containing only
 * pure logic, and this file imports its `buildRenderRegistry` as a VALUE —
 * which internally runs the shared `toPackToInstall` per queued entry, so
 * this file no longer needs to call that validation itself, only to hand it
 * a well-shaped batch. Using the shared merge also closes an asymmetry issue #19
 * accepted: this webview used to merge via `installPacks`'s ordinary
 * last-wins semantics, while `@markii/host`'s own merge already had a
 * keep-first guard against two DIFFERENT packs composing to the same
 * directive name. Now both hosts run the exact same
 * `mergePacksKeepingFirstClaim`, so the guard can no longer be present on
 * one host's path and absent on the other's.
 *
 * What STAYS local to this file, and why: reading
 * `window.__markiiPackRegistrations` itself. `@markii/host` knows nothing
 * about this global — it is this webview's own bootstrap convention (see
 * `../webview-html.ts`), not something a host-neutral package could own —
 * so this module still owns the `declare global` block and the small
 * shape-normalizing step that turns each raw queue entry into a
 * `QueuedPackRegistration` before handing the batch to the shared
 * `buildRenderRegistry`. That normalizing step deliberately does not
 * pre-filter: a raw entry that isn't even a plain object is normalized into
 * a `QueuedPackRegistration` with `undefined` fields and left for the
 * shared `toPackToInstall` to reject structurally (via its existing
 * `manifestJson`-is-a-string check), so every malformed entry produces the
 * same kind of recorded reason instead of two different discard paths.
 *
 * Every entry here crossed a JS boundary from a SEPARATELY LOADED script
 * file (a pack's prebuilt `webview.js`, not code this bundle compiled) —
 * same trust as this extension's own bundle once loaded (docs/security.md:
 * "packs are user-installed/trusted"), but still validated structurally
 * before use, because "trusted" does not mean "guaranteed well-formed": a
 * buggy or half-built pack script must degrade the SAME way an unsupported
 * engine or a missing component module already does in `@markii/react`'s
 * `loadPack` (an empty contribution, never a crash), not bring down the
 * rest of the preview.
 */
import type { Registry } from '@markii/react';
import { buildRenderRegistry as buildRenderRegistryShared } from '@markii/host/browser';
import type {
  BuildRenderRegistryResult,
  QueuedPackRegistration,
} from '@markii/host/browser';

declare global {
  interface Window {
    /** The registration queue `../webview-html.ts`'s inline bootstrap defines, and every loaded pack script pushes one entry onto by calling `__markiiRegisterPack`. Read exactly once, here, after every pack `<script>` tag has already run (script tag order — see the CSP doc comment). */
    __markiiPackRegistrations?: ReadonlyArray<{
      manifest: unknown;
      componentModules: unknown;
    }>;
    /**
     * Set by this module before mounting: the ONE React instance every pack
     * component must use (via `window.__markiiReact.createElement(...)`),
     * so a pack never bundles its own React copy and there is only ever one
     * React instance in the page. Packs read this lazily (only when a
     * component actually renders), which is safe even though pack scripts
     * load BEFORE this bundle sets it — see `../webview-html.ts`'s doc
     * comment on load order.
     */
    __markiiReact?: unknown;
    /**
     * Defined by `../webview-html.ts`'s inline bootstrap (never by this
     * module) — declared here purely so the FULL registration convention's
     * globals are typed in the one file that documents it. A pack's
     * `webview.js` calls this synchronously at load time to push one entry
     * onto `__markiiPackRegistrations`; nothing in this module ever calls
     * it itself.
     */
    __markiiRegisterPack?: (
      manifestJson: string,
      componentModules: Record<
        string,
        { component: unknown; inline?: boolean }
      >,
    ) => void;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns one raw queue entry into a `QueuedPackRegistration`, without
 * filtering: a raw entry that isn't even a plain object becomes a
 * registration with `undefined` `manifestJson`/`componentModules`, which the
 * shared `toPackToInstall` (below, via `buildRenderRegistry`) rejects
 * structurally and records a reason for, the same as any other malformed
 * entry. This keeps every entry's position in `queued` stable, so the
 * recorded `pack registration #N` reasons stay accurate.
 */
function toQueuedPackRegistration(raw: unknown): QueuedPackRegistration {
  if (!isPlainObject(raw)) {
    return { manifestJson: undefined, componentModules: undefined };
  }
  return { manifestJson: raw.manifest, componentModules: raw.componentModules };
}

/**
 * Builds the render registry: `defaultRegistry` merged with every
 * successfully validated, non-colliding pack registration collected in
 * `window.__markiiPackRegistrations`, via the shared
 * `@markii/host/browser` `buildRenderRegistry` (keep-first on a
 * composed-name collision between two different packs, whole-install
 * rejection on a namespace collision between two registrations of the same
 * pack — see that function's own doc comment). Never throws.
 *
 * Returns the full `BuildRenderRegistryResult` rather than just the
 * `Registry`, so `./main.tsx` can forward `invalidReasons`/`collisions`/
 * `duplicateComposedNames` to the extension host for the Markii output
 * channel (`../protocol.ts`'s `PackDiagnosticsMessage`) instead of only
 * logging them to the webview's own (much harder to find) devtools console.
 *
 * Called once, at mount time — `window.__markiiPackRegistrations` is only
 * ever populated by `<script>` tags that already ran before this bundle's
 * own script tag (see `../webview-html.ts`'s load order), so there is
 * nothing to re-read later.
 */
export function buildRenderRegistry(
  defaultRegistry: Registry,
): BuildRenderRegistryResult {
  const queued = window.__markiiPackRegistrations ?? [];
  const normalized = queued.map(toQueuedPackRegistration);
  const result = buildRenderRegistryShared(normalized, defaultRegistry);

  // Kept for developers with devtools open; the output channel (wired in
  // `./main.tsx`) is the surface that actually matters per AGENTS.md's
  // "clean is not silent".
  for (const reason of result.invalidReasons)
    console.error(`Markii: ${reason}`);
  if (result.collisions.length > 0) {
    console.error(
      `Markii: installed packs share a namespace (${result.collisions.join(', ')}); none of them were installed.`,
    );
  }
  for (const duplicate of result.duplicateComposedNames) {
    console.error(
      `Markii: pack "${duplicate.skippedPack}"'s component composed to the directive name "${duplicate.composedName}", already claimed by pack "${duplicate.keptPack}"; the later component was skipped.`,
    );
  }

  return result;
}
