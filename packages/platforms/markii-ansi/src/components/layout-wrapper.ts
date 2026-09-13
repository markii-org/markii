import { layoutWrapperAxis } from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import { applyLayout } from '../layout.js';
import type {
  AlignPreset,
  ResolvedLayoutPresets,
  WidthPreset,
} from '../layout.js';
import type { AnsiComponent } from '../registry.js';

/**
 * The closed set of layout-wrapper container names (docs/format.md):
 * aliases of the one shared implementation below (`createLayoutWrapper`),
 * matching `@markii/html`'s `layout-wrapper.ts`. There is deliberately no
 * `normal` alias: the default needs no wrapper at all. Every name here is
 * ALSO one of `@markii/stdlib`'s own width/align preset values (`center`/
 * `left`/`right` are align presets, `wide`/`narrow`/`full`/`fit` are width
 * presets), which is what lets `createLayoutWrapper` use the preset name
 * itself as that axis's value with no separate lookup table.
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

export type LayoutWrapperPreset = (typeof LAYOUT_WRAPPER_PRESETS)[number];

/**
 * Creates the registry component for one of docs/format.md's layout-wrapper
 * container names. One shared implementation, bound to `preset` at
 * registration time, matching `@markii/html`'s `createLayoutWrapper` in
 * spirit: it never reads `attributes` at all — `render.ts` already stripped
 * both reserved keys before this ever runs.
 *
 * A wrapper sets ONE axis by its own NAME (docs/spec.md §3): `preset` itself
 * IS that axis's value (`center` sets `align: 'center'`; `narrow` sets
 * `width: 'narrow'`), so it is applied unconditionally, whatever the author
 * wrote for that axis's own reserved attribute (already discarded — the
 * name always wins). The OTHER axis, when the author supplied it, arrives
 * as `ctx.layout` (`render.ts` resolved it on this wrapper's behalf, since
 * this wrapper is the directive's registered `layout` scope). Both are
 * merged into one `ResolvedLayoutPresets` and applied together via
 * `../layout.js`'s `applyLayout`, so `:::center{width=fit}` narrows AND
 * centers in one pass.
 */
export function createLayoutWrapper(
  preset: LayoutWrapperPreset,
): AnsiComponent {
  const ownAxis = layoutWrapperAxis(preset);
  if (ownAxis === undefined) {
    // Unreachable for the closed preset list above.
    throw new Error(`"${preset}" is not a layout-wrapper name`);
  }
  const own: ResolvedLayoutPresets =
    ownAxis === 'align'
      ? { align: preset as AlignPreset }
      : { width: preset as WidthPreset };

  return (_attributes, children, ctx) => {
    const merged: ResolvedLayoutPresets = { ...own, ...ctx.layout };
    return applyLayout(children(), merged, ctx.width);
  };
}

/** The layout axis `preset` sets by its own name. Mirrors `@markii/html`'s `layoutWrapperPresetAxis`. */
export function layoutWrapperPresetAxis(
  preset: LayoutWrapperPreset,
): LayoutAxis {
  const axis = layoutWrapperAxis(preset);
  if (axis === undefined) {
    // Unreachable for the closed preset list above.
    throw new Error(`"${preset}" is not a layout-wrapper name`);
  }
  return axis;
}
