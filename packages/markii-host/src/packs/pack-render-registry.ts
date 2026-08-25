/**
 * Validates a batch of `QueuedPackRegistration`s and merges them into a
 * render `Registry` via `@markii/react`'s `installPacks`, on top of a base
 * registry.
 *
 * Every entry here crossed a boundary from a SEPARATELY EVALUATED script (a
 * pack's compiled artifact, not code a host's own bundle compiled) — same
 * trust as that bundle once loaded (docs/security.md: "packs are
 * user-installed/trusted"), but still validated structurally before use,
 * because "trusted" does not mean "guaranteed well-formed": a buggy or
 * half-built pack script must degrade the SAME way an unsupported engine or
 * a missing component module already does in `@markii/react`'s `loadPack`
 * (an empty contribution, never a crash), not bring down the rest of a
 * preview.
 *
 * Host-neutral by design: this module takes an already-collected array of
 * queued registrations as a plain parameter, and returns the outcome as
 * data (never logs or throws), so a host wires up wherever those
 * registrations came from — VS Code reads `window.__markiiPackRegistrations`
 * off its webview and logs the result to its output channel; an Obsidian
 * plugin evaluates each pack's compiled script in-process
 * (`collectPackRegistrations`) and folds the result into its own
 * diagnostics. Reading a host-specific global and deciding where to log a
 * diagnostic line both stay in that host's own app code.
 */
import { parsePackManifest } from '@markii/pack';
import type { PackManifest } from '@markii/pack';
import { createRegistry, installPacks, mergeRegistries } from '@markii/react';
import type { PackToInstall, Registry, RegistryEntry } from '@markii/react';

/** One registration a compiled pack script queued by calling `window.__markiiRegisterPack(manifestJson, componentModules)` (see `./pack-build.ts`'s top doc comment for the full registration convention). Structurally identical across every host that satisfies the convention. */
export interface QueuedPackRegistration {
  readonly manifestJson: unknown;
  readonly componentModules: unknown;
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

/** One queued entry, validated into a `PackToInstall`, or `undefined` if either half fails validation — the reason is returned rather than logged directly, so the caller can fold it into its own diagnostics the same way every other pack failure is reported. */
function toPackToInstall(
  entry: QueuedPackRegistration,
  index: number,
): { readonly pack?: PackToInstall; readonly invalidReason?: string } {
  if (typeof entry.manifestJson !== 'string') {
    return {
      invalidReason: `pack registration #${String(index)} did not provide a manifest JSON string; ignored.`,
    };
  }
  const parsed = parsePackManifest(entry.manifestJson);
  if (!parsed.ok) {
    return {
      invalidReason: `pack registration #${String(index)}'s manifest is invalid (${parsed.errors.join('; ')}); ignored.`,
    };
  }
  if (!isPackComponentModules(entry.componentModules)) {
    return {
      invalidReason: `pack "${parsed.manifest.name}"'s registered components are malformed; ignored.`,
    };
  }
  const manifest: PackManifest = parsed.manifest;
  return { pack: { manifest, componentModules: entry.componentModules } };
}

/** What `buildRenderRegistry` reports alongside the merged registry — developer-facing diagnostics for a caller to fold into its own surface, never shown as page content. */
export interface BuildRenderRegistryResult {
  readonly registry: Registry;
  /** One line per malformed registration, dropped rather than installed. */
  readonly invalidReasons: readonly string[];
  /** Non-empty only when two or more validated registrations shared a namespace — the WHOLE install was then rejected (`installPacks`'s all-or-nothing rule) and `registry` falls back to `defaultRegistry` alone. */
  readonly collisions: readonly string[];
}

/**
 * Builds the render registry: `defaultRegistry` merged with every
 * successfully validated, non-colliding pack registration in `queued`.
 * Never throws:
 *
 * - an individual malformed registration is dropped (reason recorded, never
 *   shown on the page);
 * - a namespace collision between two loaded packs rejects the WHOLE
 *   install (matching docs/packs.md's install-time rejection rule) and this
 *   function falls back to `defaultRegistry` alone.
 */
export function buildRenderRegistry(
  queued: readonly QueuedPackRegistration[],
  defaultRegistry: Registry,
): BuildRenderRegistryResult {
  const packs: PackToInstall[] = [];
  const invalidReasons: string[] = [];

  queued.forEach((entry, index) => {
    const { pack, invalidReason } = toPackToInstall(entry, index);
    if (pack) packs.push(pack);
    if (invalidReason) invalidReasons.push(invalidReason);
  });

  if (packs.length === 0) {
    return { registry: defaultRegistry, invalidReasons, collisions: [] };
  }

  const result = installPacks(packs, defaultRegistry);
  if (result.ok) {
    return { registry: result.registry, invalidReasons, collisions: [] };
  }

  return {
    registry: mergeRegistries(createRegistry(), defaultRegistry),
    invalidReasons,
    collisions: result.collisions,
  };
}
