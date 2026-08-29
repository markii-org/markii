import type { PackManifest } from './manifest.js';

/**
 * Which directive form a pack component is written as. Mirrors
 * `@markii/stdlib`'s `ComponentKind`; defined locally here rather than
 * imported because `@markii/pack` is a published, zero-dependency package
 * (see AGENTS.md's Stack section) and `@markii/stdlib` is a sibling
 * package, not a dependency of this one. The two unions must stay aligned;
 * `@markii/host` (which depends on both) carries an executable check of
 * that alignment, since this package cannot import `@markii/stdlib` to
 * check it itself.
 */
export type PackComponentKind = 'inline' | 'leaf' | 'container';

/**
 * The three `kind` values, as runtime data. This is the ONE list: the
 * manifest validator (`./manifest.ts`) checks a declared `kind` against it,
 * and `@markii/host`'s alignment test compares it against
 * `@markii/stdlib`'s `ComponentKind` members, so the values cannot be
 * spelled differently in two places within this package and drift apart.
 */
export const PACK_COMPONENT_KINDS: readonly PackComponentKind[] = [
  'inline',
  'leaf',
  'container',
];

const PACK_COMPONENT_KIND_SET: ReadonlySet<string> = new Set(
  PACK_COMPONENT_KINDS,
);

/**
 * The object form of a `components` manifest entry. `source` is the only
 * required field (a pack-relative path, same meaning as the string
 * shorthand); `description` and `kind` are optional metadata a host can
 * surface in an insert-component catalog or similar UI.
 */
export interface PackComponentDefinition {
  source: string;
  description?: string;
  kind?: PackComponentKind;
}

/**
 * A `components` manifest entry: either the original string shorthand
 * (source path only) or the object form carrying optional metadata
 * alongside the source.
 */
export type PackComponentEntry = string | PackComponentDefinition;

/**
 * One component's declared metadata with both entry forms normalized to
 * the same shape. `description`/`kind` are only present when the manifest
 * declared them (the string shorthand never has either).
 */
export interface ResolvedPackComponent {
  readonly source: string;
  readonly description?: string;
  readonly kind?: PackComponentKind;
}

/** Same as `ResolvedPackComponent`, plus the local name it was declared under. */
export interface PackComponentListing extends ResolvedPackComponent {
  readonly localName: string;
}

/**
 * Normalizes a single `components` entry, string or object form, into the
 * common `ResolvedPackComponent` shape. This is THE accessor for reading
 * one entry — callers should never inline a `typeof entry === 'string'`
 * check of their own, so the two forms cannot silently drift apart across
 * consumers.
 *
 * Never throws and never assumes the input has already been validated by
 * `parsePackManifest`: a hostile or malformed value (not a string, not a
 * plain object, an object missing `source`, a `source` that is not a
 * non-empty string) returns `undefined` rather than throwing or fabricating
 * a value. This matters because a consumer may call this directly on
 * attacker-controlled JSON that never went through `parsePackManifest` at
 * all (for example a pack loaded from an untrusted bundle).
 */
export function resolvePackComponent(
  entry: unknown,
): ResolvedPackComponent | undefined {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { source: entry } : undefined;
  }

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  // Object.hasOwn only, matching this package's rule throughout: never read
  // an inherited property, so an object built with a hostile prototype
  // cannot smuggle a `source` through the prototype chain.
  const source = Object.hasOwn(entry, 'source')
    ? (entry as Record<string, unknown>).source
    : undefined;
  if (typeof source !== 'string' || source.length === 0) {
    return undefined;
  }

  const result: {
    source: string;
    description?: string;
    kind?: PackComponentKind;
  } = {
    source,
  };

  const description = Object.hasOwn(entry, 'description')
    ? (entry as Record<string, unknown>).description
    : undefined;
  if (typeof description === 'string' && description.length > 0) {
    result.description = description;
  }

  const kind = Object.hasOwn(entry, 'kind')
    ? (entry as Record<string, unknown>).kind
    : undefined;
  if (typeof kind === 'string' && PACK_COMPONENT_KIND_SET.has(kind)) {
    result.kind = kind as PackComponentKind;
  }

  return result;
}

/**
 * THE iterator every consumer uses instead of walking `manifest.components`
 * directly: `Object.hasOwn`-guarded, in declaration key order, skipping any
 * entry `resolvePackComponent` cannot resolve rather than throwing. This is
 * the only sanctioned way to enumerate a pack's components — see
 * `discover.ts`, `pack-build.ts`, `pack-diagnostics.ts`, and
 * `component-catalog.ts` in `@markii/host`, all of which call this instead
 * of re-implementing the walk.
 *
 * Tolerates a manifest whose `components` field is missing, `null`, not an
 * object, or an array: all of those return `[]` rather than throwing, so a
 * caller never needs to guard the call site itself.
 */
export function packComponents(
  manifest: Pick<PackManifest, 'components'>,
): PackComponentListing[] {
  const components = manifest?.components;
  if (
    components === null ||
    typeof components !== 'object' ||
    Array.isArray(components)
  ) {
    return [];
  }

  const listings: PackComponentListing[] = [];
  for (const localName of Object.keys(components)) {
    if (!Object.hasOwn(components, localName)) continue;
    const resolved = resolvePackComponent(
      (components as Record<string, unknown>)[localName],
    );
    if (resolved === undefined) continue;
    listings.push({ localName, ...resolved });
  }
  return listings;
}
