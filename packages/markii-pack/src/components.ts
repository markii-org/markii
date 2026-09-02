import type { PackManifest } from './manifest.js';

/**
 * Which directive form a pack component is written as. Mirrors
 * `@markii/stdlib`'s `ComponentKind`; defined locally here rather than
 * imported because `@markii/stdlib` is a sibling package this package
 * deliberately does not depend on, to stay decoupled from the reference
 * renderer's component contracts (see AGENTS.md's Stack section). This is
 * unrelated to `@markii/pack`'s dependency on `@markii/bundle` for `.mkp`
 * archive reading (`./archive.ts`, issue #16): that dependency reuses a
 * neutral, framework-agnostic zip reader and path jail, not a renderer
 * contract. The two unions must stay aligned;
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
 * The charset a pack's declared attribute name must match: a leading
 * lowercase letter, then lowercase letters, digits, and hyphens. Looser
 * than `namespace.ts`'s `SEGMENT_RE` on purpose, because an attribute name
 * is not a namespace: it never composes with another segment, so a
 * trailing or doubled hyphen is ugly rather than ambiguous, and there is
 * nothing for a stricter rule to protect.
 *
 * No prototype-member rejection here, unlike `validatePackName`: declared
 * attributes travel as an ARRAY, never as an object keyed by attribute
 * name, so an attribute called `constructor` is only ever compared as a
 * string and can never reach a prototype chain.
 */
export const PACK_ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Whether `name` is a usable pack attribute name. Never throws; a non-string is simply `false`. */
export function isPackAttributeName(name: unknown): name is string {
  return typeof name === 'string' && PACK_ATTRIBUTE_NAME_PATTERN.test(name);
}

/**
 * One attribute a pack component declares in `pack.json`, so a host's
 * completion, hover, and insert skeleton can offer it the same way they
 * offer a standard component's contract attributes. Every field but `name`
 * is optional: a pack that declares only names still gets attribute-name
 * completion.
 *
 * This is metadata, not enforcement. Nothing validates a rendered
 * directive's attributes against it: the renderer stays registry-driven
 * and a component owns how it reads its own props (Architecture rules 2
 * and 5). A `required` attribute an author leaves out is the component's
 * problem to handle, exactly as before.
 */
export interface PackComponentAttribute {
  /** The name an author writes inside `{...}`, e.g. `from`. Matches `PACK_ATTRIBUTE_NAME_PATTERN`. */
  readonly name: string;
  /** Human-readable semantics, shown in a completion row and in hover documentation. */
  readonly description?: string;
  /** `true` when the component is incomplete without this attribute. A required attribute is pre-filled by the insert skeleton. */
  readonly required?: boolean;
  /** The closed set of allowed values, when the attribute is an enum. Non-empty when present; offered as attribute-value completions. */
  readonly values?: readonly string[];
  /** The value used when the attribute is absent. When `values` is present, this is one of them. */
  readonly default?: string;
}

/**
 * The object form of a `components` manifest entry. `source` is the only
 * required field (a pack-relative path, same meaning as the string
 * shorthand); `description`, `kind`, and `attributes` are optional metadata
 * a host can surface in an insert-component catalog, a completion popup, or
 * hover documentation.
 */
export interface PackComponentDefinition {
  source: string;
  description?: string;
  kind?: PackComponentKind;
  /**
   * The component's declared attributes, in the order a host should offer
   * them. Optional, and omitted rather than empty when the manifest
   * declared none: `attributes: []` normalizes to absent.
   */
  attributes?: readonly PackComponentAttribute[];
}

/**
 * A `components` manifest entry: either the original string shorthand
 * (source path only) or the object form carrying optional metadata
 * alongside the source.
 */
export type PackComponentEntry = string | PackComponentDefinition;

/**
 * One component's declared metadata with both entry forms normalized to
 * the same shape. `description`/`kind`/`attributes` are only present when
 * the manifest declared them (the string shorthand never has any of them).
 */
export interface ResolvedPackComponent {
  readonly source: string;
  readonly description?: string;
  readonly kind?: PackComponentKind;
  readonly attributes?: readonly PackComponentAttribute[];
}

/** Same as `ResolvedPackComponent`, plus the local name it was declared under. */
export interface PackComponentListing extends ResolvedPackComponent {
  readonly localName: string;
}

/**
 * Reads one own property off an already-narrowed object, or `undefined`
 * when it is absent. `Object.hasOwn` only, matching this package's rule
 * throughout: an inherited property is never read, so an object built with
 * a hostile prototype cannot smuggle a value through the prototype chain.
 */
function ownProperty(entry: object, key: string): unknown {
  return Object.hasOwn(entry, key)
    ? (entry as Record<string, unknown>)[key]
    : undefined;
}

/**
 * The lenient half of attribute handling, for `resolvePackComponent`: a
 * malformed attribute entry is dropped rather than rejected, the same way
 * a malformed `description` or `kind` is simply omitted here. The strict
 * half lives in `./manifest.ts`, which rejects the whole manifest instead
 * so a pack author sees their mistake at validation time rather than
 * silently losing an attribute from a completion popup.
 */
function resolveAttribute(entry: unknown): PackComponentAttribute | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  const name = ownProperty(entry, 'name');
  if (!isPackAttributeName(name)) return undefined;

  const result: {
    name: string;
    description?: string;
    required?: boolean;
    values?: readonly string[];
    default?: string;
  } = { name };

  const description = ownProperty(entry, 'description');
  if (typeof description === 'string' && description.length > 0) {
    result.description = description;
  }

  if (ownProperty(entry, 'required') === true) {
    result.required = true;
  }

  const values = ownProperty(entry, 'values');
  if (Array.isArray(values)) {
    const cleaned = values.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (cleaned.length > 0) result.values = cleaned;
  }

  const defaultValue = ownProperty(entry, 'default');
  if (
    typeof defaultValue === 'string' &&
    defaultValue.length > 0 &&
    (result.values === undefined || result.values.includes(defaultValue))
  ) {
    result.default = defaultValue;
  }

  return result;
}

/**
 * Normalizes a declared `attributes` list: keeps declaration order, drops
 * an entry `resolveAttribute` cannot make sense of, drops a duplicate name
 * after the first, and returns `undefined` (rather than `[]`) when nothing
 * survives, so "declared no attributes" and "declared an empty list" are
 * the same state everywhere downstream.
 */
function resolveAttributes(
  raw: unknown,
): readonly PackComponentAttribute[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const seen = new Set<string>();
  const resolved: PackComponentAttribute[] = [];
  for (const entry of raw) {
    const attribute = resolveAttribute(entry);
    if (attribute === undefined || seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    resolved.push(attribute);
  }
  return resolved.length > 0 ? resolved : undefined;
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

  const source = ownProperty(entry, 'source');
  if (typeof source !== 'string' || source.length === 0) {
    return undefined;
  }

  const result: {
    source: string;
    description?: string;
    kind?: PackComponentKind;
    attributes?: readonly PackComponentAttribute[];
  } = {
    source,
  };

  const description = ownProperty(entry, 'description');
  if (typeof description === 'string' && description.length > 0) {
    result.description = description;
  }

  const kind = ownProperty(entry, 'kind');
  if (typeof kind === 'string' && PACK_COMPONENT_KIND_SET.has(kind)) {
    result.kind = kind as PackComponentKind;
  }

  const attributes = resolveAttributes(ownProperty(entry, 'attributes'));
  if (attributes !== undefined) {
    result.attributes = attributes;
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
