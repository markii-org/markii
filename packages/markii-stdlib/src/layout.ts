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
      '`right`. It only shows when the block is narrower than the page, ' +
      'so pair it with a `width` such as `fit` or `narrow`. An invalid ' +
      'value is ignored as if absent; nothing errors.',
  },
};
