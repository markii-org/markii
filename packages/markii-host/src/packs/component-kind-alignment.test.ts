/**
 * `@markii/pack`'s `PackComponentKind` is defined locally in that package
 * (it is zero-dependency and cannot import `@markii/stdlib`'s
 * `ComponentKind`) but must name exactly the same three values, in the
 * same meaning. `@markii/host` depends on both packages, so this is the
 * one place an executable check of that alignment can live — see
 * `packages/markii-pack/src/components.ts`'s doc comment on
 * `PackComponentKind` for the other half of this contract.
 *
 * Two checks: a compile-time bidirectional-assignability assertion (so a
 * drift in either union is a type error here, before any runtime test
 * runs), and a runtime check that the two value sets are exactly equal
 * (so a union edit that somehow still type-checks — reordering, or a
 * value added to both but spelled differently — is still caught).
 */
import { describe, expect, it } from 'vitest';
import { PACK_COMPONENT_KINDS } from '@markii/pack';
import type { PackComponentKind } from '@markii/pack';
import type { ComponentKind } from '@markii/stdlib';

// Compile-time bidirectional assignability. If either union gains, loses,
// or renames a member without the other following, one of these two type
// aliases fails to compile.
type _PackKindAssignableToComponentKind =
  PackComponentKind extends ComponentKind ? true : never;
type _ComponentKindAssignableToPackKind =
  ComponentKind extends PackComponentKind ? true : never;
// Referencing the aliases keeps them from being flagged as unused; there is
// nothing to do with them at runtime, the compiler check above is the point.
const _typeCheck: [
  _PackKindAssignableToComponentKind,
  _ComponentKindAssignableToPackKind,
] = [true, true];
void _typeCheck;

/**
 * Every `ComponentKind` member, as runtime data. A `Record` keyed by the
 * union is exhaustiveness-checked by the compiler in both directions: a
 * member missing here is a type error, and so is a key that is not a
 * member. That makes the object below a faithful runtime image of
 * `@markii/stdlib`'s union, which is what the assertion needs, since
 * `@markii/stdlib` exports the kinds only as a type.
 */
const COMPONENT_KIND_MEMBERS: Record<ComponentKind, true> = {
  inline: true,
  leaf: true,
  container: true,
};

describe('PackComponentKind / ComponentKind alignment', () => {
  it('name exactly the same set of values', () => {
    // The pack side is the REAL exported list, not a copy spelled here: a
    // value added to `PACK_COMPONENT_KINDS` alone fails this test.
    expect(new Set<string>(PACK_COMPONENT_KINDS)).toEqual(
      new Set(Object.keys(COMPONENT_KIND_MEMBERS)),
    );
  });
});
