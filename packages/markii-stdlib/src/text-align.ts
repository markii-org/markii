/**
 * The `text` attribute (docs/format.md, "Aligning text inside a component";
 * docs/spec.md §3): the standard set's one content-alignment attribute.
 *
 * `text` is deliberately NOT part of the layout system in `./layout.ts`.
 * `width` and `align` are reserved on every directive and are intercepted
 * by the renderer before a component ever sees them, because they mean the
 * same thing on every block. `text` means "align the text inside THIS
 * component", which only a component can act on, so it reaches the
 * component like any other attribute of its own and appears in each of
 * those components' contracts.
 *
 * This module carries values only: the closed value list and the schema
 * five contracts share. It says nothing about markup or classes; each
 * renderer's own `layout.ts` maps a value to a class.
 */
import type { AttributeSchema } from './contracts.js';

/** The closed `text=` value vocabulary, in the order docs/format.md lists them. */
export const TEXT_ALIGN_PRESETS = ['left', 'center', 'right'] as const;

/** One of the closed `text=` values. */
export type TextAlignPreset = (typeof TEXT_ALIGN_PRESETS)[number];

/**
 * The standard components that accept `text` (docs/spec.md §3). Listed here
 * so `./contracts.ts` builds all five from one source, and so a test can
 * assert the set both renderers honor is exactly this one.
 */
export const TEXT_ALIGN_COMPONENTS = [
  'row',
  'cell',
  'card',
  'callout',
  'table',
] as const;

/**
 * The shared `text` schema. Identical wording on all five components on
 * purpose: the attribute means the same thing everywhere, and a reader who
 * learned it on `callout` should not have to re-read it on `card`. The
 * row-specific cascade is spelled out because it is the one place `text`
 * reaches past the component it was written on.
 */
export const TEXT_ALIGN_ATTRIBUTE: AttributeSchema = {
  type: 'string',
  required: false,
  enum: TEXT_ALIGN_PRESETS,
  description:
    'Aligns the text inside this component: `left`, `center`, or `right`. ' +
    'On a `row` it applies to every cell, a cell with its own `text` ' +
    'overrides it, and an alignment wrapper written inside a cell wins ' +
    'over both. Unlike the reserved `align`, which places the whole box ' +
    'within the column, `text` never moves the box. An invalid value is ' +
    'ignored as if absent; nothing errors.',
};
