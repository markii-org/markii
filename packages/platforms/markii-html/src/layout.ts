import {
  ALIGN_PRESETS,
  LAYOUT_ATTRIBUTE_KEYS,
  TEXT_ALIGN_PRESETS,
  WIDTH_PRESETS,
} from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import type { DirectiveAttributes } from './registry.js';

/**
 * The closed set of layout-preset attributes (docs/format.md): a small,
 * non-freeform-CSS vocabulary any block directive can carry regardless of
 * which component renders it. These two keys are reserved: always intercepted
 * before a component sees its `attributes`, whether or not their value turns
 * out to be valid. The key list and the two preset vocabularies now live in
 * `@markii/stdlib`'s `layout.ts`, the one source both this module and
 * `@markii/react`'s `layout.ts` build their class maps from, so the two
 * renderers strip and classify the same keys the same way without a
 * hand-copied literal in either.
 */
export { LAYOUT_ATTRIBUTE_KEYS };

/** `width=normal` is the explicit default: it maps to no class, same as an absent `width`. */
const NORMAL_WIDTH = 'normal';

/**
 * `width` value -> class, derived mechanically from `@markii/stdlib`'s
 * `WIDTH_PRESETS` as `mk-width-<preset>` for every preset except `normal`
 * (which stays classless — see `NORMAL_WIDTH`). Null-prototype so a
 * hostile value like `__proto__` or `constructor` cannot resolve through
 * the prototype chain to an inherited `Object.prototype` member; it simply
 * misses the lookup, same as any other unrecognized value. `doc.css`
 * (shared with `@markii/react`) defines `.mk-width-fit`/
 * `.mk-width-narrow`/`.mk-width-wide`/`.mk-width-full` to match.
 */
const WIDTH_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  Object.fromEntries(
    WIDTH_PRESETS.filter((preset) => preset !== NORMAL_WIDTH).map((preset) => [
      preset,
      `mk-width-${preset}`,
    ]),
  ),
);

/**
 * `align` value -> class, derived mechanically from `@markii/stdlib`'s
 * `ALIGN_PRESETS` as `mk-align-<preset>`. Same null-prototype defense as
 * `WIDTH_CLASSES`. `doc.css` defines `.mk-align-left`/`.mk-align-center`/
 * `.mk-align-right` to match.
 */
const ALIGN_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  Object.fromEntries(
    ALIGN_PRESETS.map((preset) => [preset, `mk-align-${preset}`]),
  ),
);

/**
 * `text` value -> class, derived mechanically from `@markii/stdlib`'s
 * `TEXT_ALIGN_PRESETS` as `mk-text-<preset>`. Same null-prototype defense as
 * the two maps above, and the same class names `@markii/react` emits, so
 * `doc.css` covers both engines.
 *
 * `text` is NOT a reserved layout attribute: it is an ordinary
 * per-component attribute of `row`/`cell`/`card`/`callout` (docs/spec.md
 * §3), stripped by nothing and read by those four components themselves.
 * Its class map lives here only because this module is already this
 * engine's one home of "preset value -> class".
 */
const TEXT_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  Object.fromEntries(
    TEXT_ALIGN_PRESETS.map((preset) => [preset, `mk-text-${preset}`]),
  ),
);

/**
 * Resolves a `text` attribute value to its class, or `undefined` for
 * anything outside the closed `left | center | right` vocabulary (including
 * a bare/empty/hostile value): the same defensive shape as `alignClassFor`.
 * The class name is always one of the fixed literals in `TEXT_CLASSES`; an
 * author-supplied value is never interpolated into markup. Never throws.
 */
export function textClassFor(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return TEXT_CLASSES[value];
}

/**
 * Joins a component's own base class with the `text` class its `text`
 * attribute resolves to, if any. The one helper the four `text`-accepting
 * components share, matching `@markii/react`'s `withTextClass` so the two
 * engines emit the same class string.
 */
export function withTextClass(
  baseClassName: string,
  value: string | null | undefined,
): string {
  const textClass = textClassFor(value);
  return textClass ? `${baseClassName} ${textClass}` : baseClassName;
}

export interface ResolvedLayoutAttributes {
  /** `attributes` with every reserved layout key (present, valid or not) removed. */
  attributes: DirectiveAttributes;
  /** Space-joined layout classes, or `undefined` if none applied: never an empty string. */
  className?: string;
}

function widthClassFor(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value === NORMAL_WIDTH) return undefined;
  return WIDTH_CLASSES[value];
}

function alignClassFor(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return ALIGN_CLASSES[value];
}

/**
 * Splits docs/format.md's closed layout-attribute set (`width`, `align`) off
 * `attributes`, returning the remaining attributes untouched plus the combined
 * class string those two attributes resolve to, if any.
 *
 * Both keys are stripped whenever the key is present on the input, regardless
 * of whether its value is valid; they are reserved layout attributes, so
 * interception wins over a same-named attribute a component might otherwise
 * read itself. Presence is checked with `Object.hasOwn`, so a directive
 * attribute literally named `constructor` or `__proto__` is never mistaken for
 * a real key via the prototype chain. An invalid or hostile value never
 * produces a class: it is dropped silently, exactly like an absent attribute.
 * Never throws.
 *
 * `ownedAxis` names an axis the DIRECTIVE'S NAME already decided, which only
 * a layout wrapper has (`:::center` owns `align`, `:::fit` owns `width`; see
 * `@markii/stdlib`'s `layoutWrapperAxis`). That axis's attribute is still
 * stripped, exactly like any reserved key, but produces no class: the name
 * wins, so `:::center{align=right}` is simply centered. The other axis
 * resolves normally, which is what lets a wrapper carry it
 * (`:::center{width=fit}`). Mirrors `@markii/react`'s signature.
 */
export function resolveLayoutAttributes(
  attributes: DirectiveAttributes,
  ownedAxis?: LayoutAxis,
): ResolvedLayoutAttributes {
  let rest = attributes;
  const classes: string[] = [];

  if (Object.hasOwn(rest, 'width')) {
    const { width, ...remainder } = rest;
    rest = remainder;
    const widthClass = ownedAxis === 'width' ? undefined : widthClassFor(width);
    if (widthClass) classes.push(widthClass);
  }

  if (Object.hasOwn(rest, 'align')) {
    const { align, ...remainder } = rest;
    rest = remainder;
    const alignClass = ownedAxis === 'align' ? undefined : alignClassFor(align);
    if (alignClass) classes.push(alignClass);
  }

  return classes.length > 0
    ? { attributes: rest, className: classes.join(' ') }
    : { attributes: rest };
}
