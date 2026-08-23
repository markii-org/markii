import type { DirectiveAttributes } from './registry.js';

/**
 * The closed set of layout-preset attributes (docs/format.md): a small,
 * non-freeform-CSS vocabulary any block directive can carry regardless of
 * which component renders it. These two keys are reserved: always intercepted
 * before a component sees its `attributes`, whether or not their value turns
 * out to be valid. This mirrors `@markii/react`'s `layout.ts` exactly, so the
 * two renderers strip and classify the same keys the same way.
 */
export const LAYOUT_ATTRIBUTE_KEYS = ['width', 'align'] as const;

/** `width=normal` is the explicit default: it maps to no class, same as an absent `width`. */
const NORMAL_WIDTH = 'normal';

/**
 * `width` value -> class. Null-prototype so a hostile value like `__proto__`
 * or `constructor` cannot resolve through the prototype chain to an inherited
 * `Object.prototype` member; it simply misses the lookup, same as any other
 * unrecognized value.
 */
const WIDTH_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    narrow: 'mk-width-narrow',
    wide: 'mk-width-wide',
    full: 'mk-width-full',
  },
);

/** `align` value -> class. Same null-prototype defense as `WIDTH_CLASSES`. */
const ALIGN_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    left: 'mk-align-left',
    center: 'mk-align-center',
    right: 'mk-align-right',
  },
);

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
 */
export function resolveLayoutAttributes(
  attributes: DirectiveAttributes,
): ResolvedLayoutAttributes {
  let rest = attributes;
  const classes: string[] = [];

  if (Object.hasOwn(rest, 'width')) {
    const { width, ...remainder } = rest;
    rest = remainder;
    const widthClass = widthClassFor(width);
    if (widthClass) classes.push(widthClass);
  }

  if (Object.hasOwn(rest, 'align')) {
    const { align, ...remainder } = rest;
    rest = remainder;
    const alignClass = alignClassFor(align);
    if (alignClass) classes.push(alignClass);
  }

  return classes.length > 0
    ? { attributes: rest, className: classes.join(' ') }
    : { attributes: rest };
}
