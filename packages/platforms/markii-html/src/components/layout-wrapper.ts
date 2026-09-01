import { layoutWrapperAxis } from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import type { HtmlComponent } from '../registry.js';

/**
 * The closed set of layout-wrapper container names (docs/format.md):
 * aliases of the one shared implementation below (`createLayoutWrapper`),
 * matching `@markii/react`'s `layout-wrapper.tsx`. There is deliberately no
 * `normal` alias: the default needs no wrapper at all.
 */
export const LAYOUT_WRAPPER_PRESETS = [
  'center',
  'left',
  'right',
  'wide',
  'narrow',
  'full',
  'fit',
] as const;

/** One of the closed layout-wrapper preset names. */
export type LayoutWrapperPreset = (typeof LAYOUT_WRAPPER_PRESETS)[number];

/**
 * Preset -> class string. Null-prototype, mirroring `layout.ts`'s
 * `WIDTH_CLASSES`/`ALIGN_CLASSES`. `center`/`left`/`right` reuse the
 * existing `mk-align-*` classes; `wide`/`narrow`/`full`/`fit` reuse the existing
 * `mk-width-*` classes. `mk-layout` is the one class every preset adds on
 * top. Matches `@markii/react`'s `WRAPPER_CLASSES` byte-for-byte.
 */
const WRAPPER_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    center: 'mk-layout mk-align-center',
    left: 'mk-layout mk-align-left',
    right: 'mk-layout mk-align-right',
    wide: 'mk-layout mk-width-wide',
    narrow: 'mk-layout mk-width-narrow',
    full: 'mk-layout mk-width-full',
    fit: 'mk-layout mk-width-fit',
  } satisfies Record<LayoutWrapperPreset, string>,
);

/**
 * Creates the registry component for one of docs/format.md's layout-
 * wrapper container names — `:::center`, `:::left`, `:::right`, `:::wide`,
 * `:::narrow`, `:::full`, and `:::fit`. One shared implementation, bound to
 * `preset` at registration time, matching `@markii/react`'s
 * `createLayoutWrapper`.
 *
 * A wrapper sets ONE of the two layout axes by its name and takes the OTHER
 * as an attribute (docs/spec.md §3), so `:::center{width=fit}` is centered
 * AND sized to its content. It still never reads `attributes`: `width` and
 * `align` are reserved and stripped before any component sees them, so
 * `render.ts` resolves the open axis and hands the result down as
 * `ctx.layoutClassName`. That class is appended to this wrapper's own on the
 * SAME `<div>`, so the two engines emit one element carrying both classes.
 * An attribute for the wrapper's own axis never arrives at all: `render.ts`
 * drops it, and the name wins.
 *
 * `ctx.layoutClassName` is composed of fixed class literals from
 * `layout.ts`'s closed maps, never author text, so it is interpolated
 * without escaping for the same reason `className` above is.
 */
export function createLayoutWrapper(
  preset: LayoutWrapperPreset,
): HtmlComponent {
  const className = WRAPPER_CLASSES[preset] ?? 'mk-layout';

  return (_attributes, childrenHtml, ctx) => {
    const full = ctx.layoutClassName
      ? `${className} ${ctx.layoutClassName}`
      : className;
    return `<div class="${full}">${childrenHtml}</div>`;
  };
}

/**
 * The layout axis `preset` sets by its own name, read from
 * `@markii/stdlib`'s one classification of the seven wrapper names.
 * Used by `components/index.ts` to register each wrapper with the right
 * `HtmlRegistryEntry.layout`. Mirrors `@markii/react`'s
 * `layoutWrapperPresetAxis`.
 */
export function layoutWrapperPresetAxis(
  preset: LayoutWrapperPreset,
): LayoutAxis {
  const axis = layoutWrapperAxis(preset);
  if (axis === undefined) {
    // Unreachable for the closed preset list above; kept as a narrowing
    // branch rather than a non-null assertion.
    throw new Error(`"${preset}" is not a layout-wrapper name`);
  }
  return axis;
}
