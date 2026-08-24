/**
 * Resolving a note's `uses:` declaration (docs/packs.md, @markii/core's
 * `Frontmatter.uses`) against the packs a host actually has installed.
 *
 * This is host-facing metadata only: it lets a renderer say "this note uses
 * pack `ana`, which is not installed" instead of showing an unexplained
 * fallback box. It does not load, register, or validate components — it
 * just answers "of the packs this note declared, which ones do I have?".
 *
 * Pure and dependency-free, mirroring the rest of this package: no
 * filesystem, no registry, no host coupling.
 */

import { validatePackName } from './namespace.js';

/**
 * The result of resolving a note's declared `uses:` list against a host's
 * installed pack namespaces.
 *
 * `declared` is `false` only when the note had no `uses:` at all
 * (`Frontmatter.uses` was `undefined` — "not declared", as opposed to
 * `uses: []`, "declared, and it names no packs"). When `declared` is
 * `false`, `missing` and `satisfied` are both empty: there is nothing to
 * report either way.
 *
 * `missing` and `satisfied` partition the de-duplicated declared list
 * (order-preserving, first occurrence wins) between namespaces the host
 * does not have installed and ones it does. A declared name that is not
 * even a syntactically valid pack namespace (see `validatePackName`) can
 * never be "installed" under any host, so it is counted as `missing` too —
 * there is no separate bucket for it. The distinction a host UI might want
 * to draw ("pack not installed" vs. "that name could never be a pack") is
 * not this helper's job; a host that wants it can run `validatePackName`
 * itself over `missing`.
 */
export interface UsesResolution {
  declared: boolean;
  missing: string[];
  satisfied: string[];
}

/**
 * Resolves a note's declared `uses:` list against the pack namespaces a
 * host has installed. Never throws.
 *
 * - `declaredUses` is `undefined` when the note declared no `uses:` at all;
 *   `resolveUses` returns `{ declared: false, missing: [], satisfied: [] }`
 *   in that case without inspecting `installedNamespaces`.
 * - `declaredUses: []` ("declared, names no packs") returns
 *   `{ declared: true, missing: [], satisfied: [] }`.
 * - `installedNamespaces` is consumed into a `Set` once, so any iterable
 *   works (an array, another `Set`, a generator) and lookups are O(1)
 *   regardless of how many packs are installed. A `Set` built from
 *   attacker-controlled strings (e.g. `"__proto__"`) is a safe lookup
 *   target: `Set.prototype.has` does not consult the prototype chain the
 *   way a plain-object property read would, so no `Object.hasOwn` guard is
 *   needed here (unlike `namespace.ts`'s object-key readers).
 * - Duplicate names in `declaredUses` are de-duplicated; the first
 *   occurrence's position is what determines its place in the output
 *   arrays, so host messaging ("missing: ana, gh") stays stable regardless
 *   of how many times a note repeats a name.
 * - Neither input is mutated.
 */
export function resolveUses(
  declaredUses: readonly string[] | undefined,
  installedNamespaces: Iterable<string>,
): UsesResolution {
  if (declaredUses === undefined) {
    return { declared: false, missing: [], satisfied: [] };
  }

  const installed = new Set(installedNamespaces);
  const seen = new Set<string>();
  const missing: string[] = [];
  const satisfied: string[] = [];

  for (const name of declaredUses) {
    if (seen.has(name)) continue;
    seen.add(name);

    if (installed.has(name)) {
      satisfied.push(name);
    } else {
      missing.push(name);
    }
  }

  return { declared: true, missing, satisfied };
}

/**
 * Convenience re-export point for callers that want to flag a declared name
 * that could never be a valid pack namespace in the first place (distinct
 * from "valid namespace, just not installed"). `resolveUses` itself does not
 * draw this distinction — see `UsesResolution`'s docs — so a host that wants
 * it filters `missing` through this predicate.
 */
export function isValidPackNameShape(name: string): boolean {
  return validatePackName(name).ok;
}
