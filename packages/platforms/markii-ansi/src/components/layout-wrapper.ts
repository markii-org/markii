import { layoutWrapperAxis } from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import { applyLayout } from '../layout.js';
import type {
  AlignPreset,
  ResolvedLayoutPresets,
  WidthPreset,
} from '../layout.js';
import { childrenText, type AnsiComponent } from '../registry.js';

/**
 * The closed set of layout-wrapper container names (docs/format.md):
 * aliases of the one shared implementation below (`createLayoutWrapper`).
 * There is deliberately no `normal` alias: the default needs no wrapper at
 * all. Every name here is ALSO one of `@markii/stdlib`'s own width/align
 * preset values.
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
 * registration time: it never reads `attributes` at all — `render.tsx`
 * already stripped both reserved keys before this ever runs.
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

  return ({ children, ctx }) => {
    const merged: ResolvedLayoutPresets = { ...own, ...ctx.layout };
    return applyLayout(childrenText(children), merged, ctx.width);
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
