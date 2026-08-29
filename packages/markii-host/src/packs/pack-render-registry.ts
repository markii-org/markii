/**
 * Validates a batch of `QueuedPackRegistration`s and merges them into a
 * render `Registry` on top of a base registry, using `@markii/react`'s
 * `loadPack` per pack (namespace-collision rejection reimplemented here so
 * this module can also guard against a same-composed-name collision
 * between two differently named packs — see `DuplicateComposedName` and
 * `mergePacksKeepingFirstClaim`).
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
import { detectNamespaceCollisions, parsePackManifest } from '@markii/pack';
import type { PackManifest } from '@markii/pack';
import { createRegistry, loadPack, mergeRegistries } from '@markii/react';
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

/**
 * One queued entry, validated into a `PackToInstall`, or `undefined` if
 * either half fails validation — the reason is returned rather than logged
 * directly, so the caller can fold it into its own diagnostics the same way
 * every other pack failure is reported.
 *
 * Deliberately NOT exported, including from `../browser.ts`: every caller,
 * VS Code's webview included, reaches this through `buildRenderRegistry`,
 * which runs it per queued entry. A host reads its own registration queue
 * off its own global and hands over the batch; validating that batch is
 * this module's job, and keeping the per-entry step private means there is
 * one entry point into it rather than two.
 */
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

/**
 * One composed directive name two DIFFERENT packs both claimed. Under
 * `@markii/pack`'s current underscore join (issue #19) this cannot arise
 * from two packs' names and local names composing to the same string — the
 * join is bijective (see `namespace.ts`'s `composeDirectiveName` doc
 * comment) — so this is a defense-in-depth invariant, not a reachable case
 * of ordinary pack composition. It stays because a hand-written pack
 * registration script (or a future regression in the composition rule)
 * could still hand `buildRenderRegistry` two registrations that carry the
 * identical composed name; when that happens the FIRST claimant keeps the
 * name and the later one is dropped, exactly like a malformed registration.
 */
export interface DuplicateComposedName {
  readonly composedName: string;
  /** The pack whose component kept the name. */
  readonly keptPack: string;
  /** The pack whose component was skipped because the name was already taken. */
  readonly skippedPack: string;
}

/** What `buildRenderRegistry` reports alongside the merged registry — developer-facing diagnostics for a caller to fold into its own surface, never shown as page content. */
export interface BuildRenderRegistryResult {
  readonly registry: Registry;
  /** One line per malformed registration, dropped rather than installed. */
  readonly invalidReasons: readonly string[];
  /** Non-empty only when two or more validated registrations shared a namespace — the WHOLE install was then rejected (docs/packs.md's install-time rejection rule) and `registry` falls back to `defaultRegistry` alone. */
  readonly collisions: readonly string[];
  /** One entry per composed directive name claimed by two different packs — see `DuplicateComposedName`. Always empty for registrations that went through ordinary composition; kept as an executable invariant, not dead code (see `./pack-render-registry.test.ts`'s constructed-collision test). */
  readonly duplicateComposedNames: readonly DuplicateComposedName[];
}

/**
 * Loads every pack's own registry (`@markii/react`'s `loadPack`, which
 * already gates on engine and skips an unsatisfied component) and merges
 * them onto `base` left to right, but — unlike `@markii/react`'s ordinary
 * `mergeRegistries` last-wins semantics — keeps the FIRST pack to claim a
 * given composed directive name and skips any later pack that claims the
 * same name, recording the skip as a `DuplicateComposedName`. `base`'s own
 * entries are not part of this check: a pack's composed name overriding an
 * unrelated `base` entry is ordinary last-wins behavior, the same as
 * `installPacks` already gives it.
 */
function mergePacksKeepingFirstClaim(
  packs: readonly PackToInstall[],
  base: Registry,
): { registry: Registry; duplicateComposedNames: DuplicateComposedName[] } {
  const merged: Record<string, RegistryEntry> = { ...base };
  const owner = new Map<string, string>();
  const duplicateComposedNames: DuplicateComposedName[] = [];

  for (const pack of packs) {
    const loaded = loadPack(pack.manifest, pack.componentModules);
    for (const composedName of Object.keys(loaded)) {
      if (!Object.hasOwn(loaded, composedName)) continue;
      const existingOwner = owner.get(composedName);
      if (existingOwner !== undefined) {
        duplicateComposedNames.push({
          composedName,
          keptPack: existingOwner,
          skippedPack: pack.manifest.name,
        });
        continue;
      }
      owner.set(composedName, pack.manifest.name);
      merged[composedName] = loaded[composedName]!;
    }
  }

  return { registry: createRegistry(merged), duplicateComposedNames };
}

/**
 * Builds the render registry: `defaultRegistry` merged with every
 * successfully validated, non-colliding pack registration in `queued`.
 * Never throws:
 *
 * - an individual malformed registration is dropped (reason recorded, never
 *   shown on the page);
 * - a namespace collision between two loaded packs (the same pack name
 *   registered twice) rejects the WHOLE install (matching docs/packs.md's
 *   install-time rejection rule) and this function falls back to
 *   `defaultRegistry` alone;
 * - a composed-directive-name collision between two DIFFERENTLY named packs
 *   (see `DuplicateComposedName`) drops only the later claimant's
 *   component, not the whole pack.
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
    return {
      registry: defaultRegistry,
      invalidReasons,
      collisions: [],
      duplicateComposedNames: [],
    };
  }

  const namespaces = packs.map((pack) => pack.manifest.name);
  const namespaceCollisions = detectNamespaceCollisions(namespaces);
  if (namespaceCollisions.length > 0) {
    return {
      registry: mergeRegistries(createRegistry(), defaultRegistry),
      invalidReasons,
      collisions: namespaceCollisions.map((collision) => collision.namespace),
      duplicateComposedNames: [],
    };
  }

  const { registry, duplicateComposedNames } = mergePacksKeepingFirstClaim(
    packs,
    defaultRegistry,
  );

  return { registry, invalidReasons, collisions: [], duplicateComposedNames };
}
