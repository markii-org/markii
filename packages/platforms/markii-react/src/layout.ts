import type { DirectiveAttributes } from './registry.js';

/**
 * The closed set of layout-preset attributes (DESIGN.md §4): a small,
 * non-freeform-CSS vocabulary any block directive can carry regardless of
 * which component renders it. These two keys are reserved — always
 * intercepted before a component sees its `attributes`, whether or not
 * their value turns out to be valid (see `resolveLayoutAttributes` below).
 */
export const LAYOUT_ATTRIBUTE_KEYS = ['width', 'align'] as const;

/** `width=normal` is the explicit default — it maps to no class, same as an absent `width`. */
const NORMAL_WIDTH = 'normal';

/**
 * `width` value -> class. Null-prototype so a hostile value like
 * `'__proto__'` or `'constructor'` cannot resolve through the prototype
 * chain to an inherited `Object.prototype` member — it simply misses the
 * lookup, same as any other unrecognized value (matches the same defensive
 * pattern `@markii/core`'s `URL_ATTRIBUTE_BY_TAG` uses in `to-hast.ts`).
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
  /** Space-joined layout classes, or `undefined` if none applied — never an empty string. */
  className?: string;
}

/**
 * Resolves a `width` attribute value to its class, or `undefined` for
 * anything that isn't exactly one of the closed enum's literal strings —
 * including the explicit default (`normal`, which is deliberately classless,
 * matching an absent `width`), a bare/valueless attribute (`null`), an empty
 * string, and any other text (a typo, wrong case, or a hostile value like
 * `javascript:alert(1)`). The class name is always one of the fixed literals
 * in `WIDTH_CLASSES` above — an author-supplied value is never interpolated
 * into a class name or DOM attribute.
 */
function widthClassFor(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value === NORMAL_WIDTH) return undefined;
  return WIDTH_CLASSES[value];
}

/**
 * Resolves an `align` attribute value to its class, or `undefined` for
 * anything outside the closed `left | center | right` enum (including bare/
 * empty/hostile values) — same defensive shape as `widthClassFor`.
 */
function alignClassFor(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return ALIGN_CLASSES[value];
}

/**
 * Splits DESIGN.md §4's closed layout-attribute set (`width`, `align`) off
 * `attributes`, returning the remaining attributes untouched (mirrors
 * `render.tsx`'s `resolveDataAttribute` for the `data=` key: same shape,
 * same never-throw contract) plus the combined class string those two
 * attributes resolve to, if any.
 *
 * Both keys are stripped from the returned `attributes` whenever the key is
 * *present* on the input, regardless of whether its value is valid — they
 * are reserved layout attributes, so interception wins over a same-named
 * attribute a component might otherwise want to read itself (e.g. `chart`'s
 * own `width`). Presence is checked with `Object.hasOwn`, not `in` or bare
 * indexing, so a directive attribute literally named `constructor` or
 * `__proto__` can never be mistaken for a real key via the prototype chain.
 *
 * A hostile or merely invalid value (wrong case, unknown word, a string
 * containing `"`, `;`, `{`, `}`, a `javascript:` URI, `<script>`, ...) never
 * produces a class — it is dropped silently, exactly like an absent
 * attribute. This function never throws.
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
