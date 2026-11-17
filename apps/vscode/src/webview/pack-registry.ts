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
 * That is fixed now: `@markii/host`'s main entry (`packages/markii-host/src/
 * index.ts`) is environment-free, and this file imports its `buildRenderRegistry` as a VALUE —
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
 * What STAYS local to this file, and why: the `declare global` block and
 * the read of `window.__markiiPackRegistrations`. The webview cannot use
 * `@markii/react`'s `evaluatePackScripts`: that runs each script with the
 * `Function` constructor and needs `'unsafe-eval'`, which this page's
 * nonce-only policy forbids. The page loads each pack script as a
 * `<script nonce>` element instead (see `../webview-html.ts`), and
 * `readPackRegistrationQueue` turns the queue they filled into the batch
 * the shared `buildRenderRegistry` takes. It does not pre-filter: a raw
 * entry that is not an object becomes a registration with `undefined`
 * fields, which `buildRenderRegistry` rejects with a recorded reason.
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
import { reactPackEngine, readPackRegistrationQueue } from '@markii/react';
import type { Registry } from '@markii/react';
import { buildRenderRegistry as buildRenderRegistryShared } from '@markii/host';
import type { BuildRenderRegistryResult } from '@markii/host';

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

/**
 * Builds the render registry: `defaultRegistry` merged with every
 * successfully validated, non-colliding pack registration collected in
 * `window.__markiiPackRegistrations`, via the shared
 * `@markii/host` `buildRenderRegistry` (keep-first on a
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
): BuildRenderRegistryResult<Registry> {
  // A raw entry that is not an object is blanked, not dropped, so the
  // recorded `pack registration #N` reasons keep their positions.
  const normalized = readPackRegistrationQueue(
    window.__markiiPackRegistrations,
  );
  const result = buildRenderRegistryShared(
    normalized,
    defaultRegistry,
    reactPackEngine,
  );

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
