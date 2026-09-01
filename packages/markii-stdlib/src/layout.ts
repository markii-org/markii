/**
 * The neutral definition of docs/format.md's layout system: the two
 * reserved attributes every block directive can carry (`width`, `align`)
 * and their closed preset vocabularies. Zero dependency, matching this
 * package's own posture — every renderer (`@markii/react`, `@markii/html`,
 * and any future one) builds its class-mapping logic off these same value
 * lists instead of hand-copying the literals, which is how the two
 * existing renderers drifted into two near-identical copies in the first
 * place.
 *
 * This module carries VALUES only (the attribute names, the preset lists,
 * and the two attributes expressed as `AttributeSchema`s for a tool that
 * documents or completes attributes). It says nothing about markup,
 * classes, or rendering; see each renderer's own `layout.ts` for that.
 */
import type { AttributeSchema } from './contracts.js';

/** The two attribute names docs/format.md reserves on every block directive. */
export const LAYOUT_ATTRIBUTE_KEYS = ['width', 'align'] as const;

/**
 * One of the two layout axes. `width` sizes a block's box; `align` places
 * that box within the column. They are independent: every block has a
 * value on both, and setting one never implies the other.
 */
export type LayoutAxis = (typeof LAYOUT_ATTRIBUTE_KEYS)[number];

/** The axis a wrapper of the other axis takes as an attribute (docs/spec.md §3). */
export function otherLayoutAxis(axis: LayoutAxis): LayoutAxis {
  return axis === 'width' ? 'align' : 'width';
}

/**
 * The closed `width=` preset vocabulary (docs/format.md), listed narrowest
 * to widest so the list reads as the scale it is: `fit` hugs the block's
 * own content, `normal` is the default column width, and `full` fills the
 * column. Order is user-visible: a completion popup offers the values in
 * this order.
 */
export const WIDTH_PRESETS = [
  'fit',
  'narrow',
  'normal',
  'wide',
  'full',
] as const;

/** The closed `align=` preset vocabulary (docs/format.md), in the order the docs list them. */
export const ALIGN_PRESETS = ['left', 'center', 'right'] as const;

/**
 * Wrapper-name lookups as sets rather than `Array.includes` scans: a `Set`
 * answers "is this a wrapper name" without ever resolving through a
 * prototype chain, so a directive literally named `constructor` or
 * `__proto__` misses cleanly. Built from the two preset lists above, so the
 * wrapper vocabulary can never drift from the attribute vocabulary; there
 * is no `normal` wrapper, since the default width needs no wrapper at all.
 */
const ALIGN_WRAPPER_NAMES: ReadonlySet<string> = new Set(ALIGN_PRESETS);

const WIDTH_WRAPPER_NAMES: ReadonlySet<string> = new Set(
  WIDTH_PRESETS.filter((preset) => preset !== 'normal'),
);

/**
 * The layout axis the wrapper container named `name` sets by its NAME
 * (docs/format.md, "The same presets as wrappers"), or `undefined` when
 * `name` is not one of the seven wrapper names.
 *
 * This is the one place the seven names are classified. A wrapper owns its
 * own axis and takes the OTHER axis as an attribute, so both renderers and
 * the completion layer need the same answer to "which axis does this name
 * already decide?" — deriving it here keeps a hand-copied per-name mapping
 * out of all three.
 */
export function layoutWrapperAxis(name: string): LayoutAxis | undefined {
  if (ALIGN_WRAPPER_NAMES.has(name)) return 'align';
  if (WIDTH_WRAPPER_NAMES.has(name)) return 'width';
  return undefined;
}

/**
 * The two reserved layout attributes as `AttributeSchema`s, so a tool that
 * completes or documents attributes reads them exactly like a component's
 * own.
 */
export const LAYOUT_ATTRIBUTES: Readonly<
  Record<'width' | 'align', AttributeSchema>
> = {
  width: {
    type: 'string',
    required: false,
    enum: WIDTH_PRESETS,
    description:
      'Sets how wide the directive renders, from narrowest to widest: ' +
      '`fit` shrinks the block to its own content, then `narrow`, ' +
      '`normal` at the default column width, `wide`, and `full`. ' +
      '`normal` is the explicit default and produces no class, the same ' +
      'as leaving `width` off entirely. An invalid value is ignored as if ' +
      'absent; nothing errors.',
  },
  align: {
    type: 'string',
    required: false,
    enum: ALIGN_PRESETS,
    description:
      'Places the directive within the column: `left`, `center`, or ' +
      "`right`, defaulting to `left`. It moves the block's box and never " +
      'its contents, so it only shows when the box is narrower than the ' +
      'column: pair it with a `width` such as `fit` or `narrow`. An ' +
      'invalid value is ignored as if absent; nothing errors.',
  },
};
