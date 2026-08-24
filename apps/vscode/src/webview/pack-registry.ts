/**
 * The webview half of the pack registration convention (GitHub issue #3
 * slice 5, docs/packs.md): reads whatever `window.__markiiPackRegistrations`
 * collected (see `../webview-html.ts`'s doc comment for the full convention
 * and load order) and merges every validated entry into the render registry
 * via `@markii/react`'s `installPacks`, on top of `defaultRegistry`.
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
import { parsePackManifest } from '@markii/pack';
import type { PackManifest } from '@markii/pack';
import { createRegistry, installPacks, mergeRegistries } from '@markii/react';
import type { PackToInstall, Registry, RegistryEntry } from '@markii/react';

/**
 * One queued registration: `manifestJson` is the pack's `pack.json`
 * contents, embedded as a JSON string literal in the pack's build (the
 * SAME validator this extension's own manifest reading would use, via
 * `@markii/pack`'s `parsePackManifest` — never a second, looser parser).
 * `componentModules` is a plain object of local component name ->
 * `{component, inline?}`, matching `@markii/react`'s `PackComponentModules`
 * shape — checked structurally below, since nothing on this boundary is
 * typed at compile time.
 */
interface QueuedPackRegistration {
  readonly manifestJson: unknown;
  readonly componentModules: unknown;
}

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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Structurally validates one `componentModules` object: every OWN entry has a function `component` and an optional boolean `inline`. Read with `Object.hasOwn` only — the same hostile-map discipline `@markii/pack`/`@markii/react` use throughout, so a `componentModules` object with a poisoned `__proto__` can't leak an inherited value in as a registered component. */
function isPackComponentModules(
  value: unknown,
): value is Record<string, RegistryEntry> {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!hasOwn(value, key)) continue;
    const entry = value[key];
    if (!isPlainObject(entry)) return false;
    if (typeof entry.component !== 'function') return false;
    if (hasOwn(entry, 'inline') && typeof entry.inline !== 'boolean') {
      return false;
    }
  }
  return true;
}

/** One queued entry, validated into a `PackToInstall`, or `undefined` if either half fails validation — logged to the console (developer-facing only, never shown on the page) and simply dropped, never thrown. */
function toPackToInstall(
  entry: QueuedPackRegistration,
  index: number,
): PackToInstall | undefined {
  if (typeof entry.manifestJson !== 'string') {
    console.error(
      `Markii: pack registration #${index} did not provide a manifest JSON string; ignored.`,
    );
    return undefined;
  }
  const parsed = parsePackManifest(entry.manifestJson);
  if (!parsed.ok) {
    console.error(
      `Markii: pack registration #${index}'s manifest is invalid (${parsed.errors.join('; ')}); ignored.`,
    );
    return undefined;
  }
  if (!isPackComponentModules(entry.componentModules)) {
    console.error(
      `Markii: pack "${parsed.manifest.name}"'s registered components are malformed; ignored.`,
    );
    return undefined;
  }
  const manifest: PackManifest = parsed.manifest;
  return { manifest, componentModules: entry.componentModules };
}

/**
 * Builds the render registry: `defaultRegistry` merged with every
 * successfully validated, non-colliding pack registration collected in
 * `window.__markiiPackRegistrations`. Never throws:
 *
 * - an individual malformed registration is dropped (logged, not shown);
 * - a namespace collision between two loaded packs rejects the WHOLE
 *   install (`@markii/react`'s `installPacks`, matching docs/packs.md's
 *   install-time rejection rule) and this function falls back to
 *   `defaultRegistry` alone, logging which namespaces collided — every
 *   pack directive then shows the ordinary unknown-component fallback
 *   rather than an arbitrarily-chosen winner silently shadowing the other.
 *
 * Called once, at mount time — `window.__markiiPackRegistrations` is only
 * ever populated by `<script>` tags that already ran before this bundle's
 * own script tag (see `../webview-html.ts`'s load order), so there is
 * nothing to re-read later.
 */
export function buildRenderRegistry(defaultRegistry: Registry): Registry {
  const queued = window.__markiiPackRegistrations ?? [];
  const packs: PackToInstall[] = [];

  queued.forEach((raw, index) => {
    if (!isPlainObject(raw)) return;
    const entry: QueuedPackRegistration = {
      manifestJson: raw.manifest,
      componentModules: raw.componentModules,
    };
    const pack = toPackToInstall(entry, index);
    if (pack) packs.push(pack);
  });

  if (packs.length === 0) return defaultRegistry;

  const result = installPacks(packs, defaultRegistry);
  if (result.ok) return result.registry;

  console.error(
    `Markii: installed packs share a namespace (${result.collisions.join(', ')}); none of them were installed.`,
  );
  return mergeRegistries(createRegistry(), defaultRegistry);
}
