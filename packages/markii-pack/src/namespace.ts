/**
 * Namespace rules from docs/packs.md and spec.md §1:
 *
 * - Directive names MUST NOT contain `:` (reserved syntax).
 * - A namespaced directive name joins the pack's namespace and the
 *   component's local name with `_`, and only `_` (issue #19). The spec
 *   permits `-` or `_` for a directive name generally; this package composes
 *   exactly one of them, so the boundary between the two parts is always
 *   unambiguous. See `composeDirectiveName` for why.
 * - The bundle's reserved first-path-segment names (`scripts`, `assets`,
 *   `.cache`) can never be a pack namespace, so a pack can never shadow
 *   bundle structure in `require` or in directive names.
 *
 * This module is pure and dependency-free, mirroring `@markii/bundle`'s
 * `paths.ts`: no filesystem, no registry, just the string rules a later
 * slice (registry loading, install-time rejection) builds on.
 *
 * Design decision (orchestrator sign-off requested — see the slice-0
 * report): the charset chosen for both a pack namespace and a pack's local
 * component names is lowercase-kebab, matching spec.md §1's "SHOULD be
 * lowercase-kebab" guidance for directive names generally: a leading
 * lowercase letter, then lowercase letters/digits, with single internal
 * hyphens as separators (no leading/trailing hyphen, no doubled hyphen).
 * This is deliberately conservative — it's stricter than the spec's bare
 * "MUST NOT contain `:`" requirement — because a namespace also has to
 * compose cleanly with a local name without producing an ambiguous or
 * surprising directive name. Underscore is the composition separator
 * (`ana_timeline`) and is deliberately NOT accepted inside the namespace or
 * local-name segments themselves, which is exactly what makes the composed
 * name's single underscore mark the boundary unambiguously.
 */

/** The reserved bundle directory names a pack namespace must never collide with (spec.md §1, §8). */
export const RESERVED_NAMESPACE_SEGMENTS: ReadonlySet<string> = new Set([
  'scripts',
  'assets',
  '.cache',
]);

// Lowercase-kebab: starts with a lowercase letter, then lowercase
// letters/digits, with single internal hyphens. No leading/trailing
// hyphen, no consecutive hyphens, no underscore, no colon, no uppercase.
const SEGMENT_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Plain object prototype members that would otherwise pass SEGMENT_RE (they
// are lowercase-kebab-shaped, no ":" or "_"). Rejected by name, defense in
// depth alongside every reader in this package using Object.hasOwn: a
// namespace or local name equal to one of these is never a meaningful
// component name and is exactly the shape a prototype-pollution probe uses.
const PROTOTYPE_MEMBER_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'hasownproperty',
  'valueof',
  'tostring',
  'isprototypeof',
]);

export type NamespaceValidationResult =
  { ok: true } | { ok: false; reason: string };

/**
 * Validates a pack name (the pack's namespace). Never throws.
 *
 * Rejects: non-strings, empty strings, anything outside the lowercase-kebab
 * charset (this also rejects `:` and any prototype-pollution-shaped name
 * such as `__proto__` or `constructor`, since neither matches the charset),
 * and the reserved bundle segments `scripts`, `assets`, `.cache`.
 */
export function validatePackName(name: unknown): NamespaceValidationResult {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'pack name must be a non-empty string' };
  }
  if (name.includes(':')) {
    return { ok: false, reason: 'pack name must not contain ":"' };
  }
  if (RESERVED_NAMESPACE_SEGMENTS.has(name)) {
    return {
      ok: false,
      reason: `"${name}" is a reserved bundle segment and cannot be a pack namespace`,
    };
  }
  if (PROTOTYPE_MEMBER_NAMES.has(name.toLowerCase())) {
    return {
      ok: false,
      reason: `"${name}" is a reserved object-prototype member name and cannot be a pack name`,
    };
  }
  if (!SEGMENT_RE.test(name)) {
    return {
      ok: false,
      reason:
        'pack name must be lowercase-kebab: a lowercase letter, then lowercase letters/digits, with single internal hyphens',
    };
  }
  return { ok: true };
}

/**
 * Validates a pack's local component name (the key on the manifest's
 * `components` map, before namespacing). Same lowercase-kebab charset as a
 * pack name; this also rejects prototype-pollution-shaped keys.
 */
export function validateLocalComponentName(
  name: unknown,
): NamespaceValidationResult {
  if (typeof name !== 'string' || name.length === 0) {
    return {
      ok: false,
      reason: 'component name must be a non-empty string',
    };
  }
  if (name.includes(':')) {
    return { ok: false, reason: 'component name must not contain ":"' };
  }
  if (PROTOTYPE_MEMBER_NAMES.has(name.toLowerCase())) {
    return {
      ok: false,
      reason: `"${name}" is a reserved object-prototype member name and cannot be a component name`,
    };
  }
  if (!SEGMENT_RE.test(name)) {
    return {
      ok: false,
      reason:
        'component name must be lowercase-kebab: a lowercase letter, then lowercase letters/digits, with single internal hyphens',
    };
  }
  return { ok: true };
}

export type ComposeDirectiveNameResult =
  { ok: true; name: string } | { ok: false; reason: string };

/**
 * Composes the directive name an author types to reference a pack's
 * component, e.g. `composeDirectiveName('ana', 'timeline')` -> `ana_timeline`
 * (docs/packs.md). Validates both inputs first, then the composed result
 * (defense in depth: the composed string must still contain no `:` and must
 * still be a legal directive-name shape).
 *
 * The separator is `_`, and there is deliberately no way to ask for another
 * one (issue #19, user-settled 2026-08-30). It used to be `-`, which is also
 * the separator INSIDE a lowercase-kebab pack or local name, so two
 * different packs could compose the same directive name: pack `long` plus
 * component `pack-name-some-component` and pack `long-pack-name` plus
 * component `some-component` both produced `long-pack-name-some-component`,
 * and one silently shadowed the other. `SEGMENT_RE` bans `_` inside either
 * segment, so an underscore join gives every composed name exactly one
 * underscore, at the pack/component boundary. That makes the split
 * bijective and this whole collision class impossible to construct rather
 * than merely detected.
 *
 * Accepting both forms would have kept the ambiguity alive, so only this one
 * exists. Notes and packs written against the old `-` composition stop
 * resolving and render the labeled unknown-component fallback; that breakage
 * was weighed and accepted pre-1.0 rather than carrying a migration shim.
 */
export function composeDirectiveName(
  packName: string,
  localName: string,
): ComposeDirectiveNameResult {
  const separator = '_';
  const packResult = validatePackName(packName);
  if (!packResult.ok) return packResult;

  const localResult = validateLocalComponentName(localName);
  if (!localResult.ok) return localResult;

  const composed = `${packName}${separator}${localName}`;

  if (composed.includes(':')) {
    return {
      ok: false,
      reason: 'composed directive name must not contain ":"',
    };
  }
  // The composed name must still look like a directive name: lowercase
  // letters/digits/hyphens/underscores only, starting with a letter. This
  // is deliberately looser than SEGMENT_RE (it allows the separator
  // character throughout) since the composed string is not itself
  // re-parsed into namespace/local parts anywhere in this package.
  if (!/^[a-z][a-z0-9_-]*$/.test(composed)) {
    return {
      ok: false,
      reason: `composed directive name "${composed}" is not a legal directive name`,
    };
  }

  return { ok: true, name: composed };
}

export interface NamespaceCollision {
  namespace: string;
  /** How many times this namespace appears in the input. */
  count: number;
}

/**
 * Given several installed pack namespaces, returns the ones that appear
 * more than once. Pure predicate only — docs/packs.md says installing two
 * packs with the same namespace is rejected at install time, but that
 * install-time rejection (and the vault-library-shadows-a-pack warning
 * case) is a later slice; this is the detection primitive it will use.
 *
 * Comparison is exact-string (case-sensitive), matching `validatePackName`
 * which already forces lowercase, so two namespaces differing only in case
 * cannot arise from valid input in the first place.
 */
export function detectNamespaceCollisions(
  namespaces: readonly string[],
): NamespaceCollision[] {
  const counts = new Map<string, number>();
  for (const ns of namespaces) {
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  const collisions: NamespaceCollision[] = [];
  for (const [namespace, count] of counts) {
    if (count > 1) collisions.push({ namespace, count });
  }
  return collisions;
}
