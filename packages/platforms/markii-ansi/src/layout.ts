import {
  ALIGN_PRESETS,
  LAYOUT_ATTRIBUTE_KEYS,
  WIDTH_PRESETS,
} from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import { pad, wrap } from './box.js';
import { measure } from './measure.js';
import type { DirectiveAttributes } from './registry.js';

/**
 * The terminal counterpart of `@markii/html`'s `layout.ts`: the same closed
 * `width`/`align` vocabulary from `@markii/stdlib`, but resolved to COLUMN
 * ARITHMETIC instead of a CSS class, since there is no stylesheet here. The
 * two reserved keys are still always stripped off a directive's attributes
 * before a component sees them, whether or not their value turns out to be
 * valid, exactly like the other two engines.
 */
export { LAYOUT_ATTRIBUTE_KEYS };

export type WidthPreset = (typeof WIDTH_PRESETS)[number];
export type AlignPreset = (typeof ALIGN_PRESETS)[number];

const NORMAL_WIDTH: WidthPreset = 'normal';

function widthPresetFor(
  value: string | null | undefined,
): WidthPreset | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value === NORMAL_WIDTH) return undefined;
  return (WIDTH_PRESETS as readonly string[]).includes(value)
    ? (value as WidthPreset)
    : undefined;
}

function alignPresetFor(
  value: string | null | undefined,
): AlignPreset | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return (ALIGN_PRESETS as readonly string[]).includes(value)
    ? (value as AlignPreset)
    : undefined;
}

/** The two layout attributes' resolved preset names, present only for a preset that actually applied. */
export interface ResolvedLayoutPresets {
  width?: WidthPreset;
  align?: AlignPreset;
}

export interface ResolvedLayoutAttributes {
  /** `attributes` with every reserved layout key (present, valid or not) removed. */
  attributes: DirectiveAttributes;
  /** The resolved presets, or `undefined` if neither attribute produced one. */
  resolved?: ResolvedLayoutPresets;
}

/**
 * Splits `width`/`align` off `attributes`, returning the remaining
 * attributes untouched plus the presets those two attributes resolved to,
 * if any. Same rules as `@markii/html`'s `resolveLayoutAttributes`: both
 * keys are stripped whenever present regardless of validity; an invalid or
 * hostile value never produces a preset; `ownedAxis` (a layout wrapper's own
 * axis) strips its attribute but produces no preset for it, since the
 * directive's NAME already decided that axis. Never throws.
 */
export function resolveLayoutAttributes(
  attributes: DirectiveAttributes,
  ownedAxis?: LayoutAxis,
): ResolvedLayoutAttributes {
  let rest = attributes;
  const resolved: ResolvedLayoutPresets = {};

  if (Object.hasOwn(rest, 'width')) {
    const { width, ...remainder } = rest;
    rest = remainder;
    const preset = ownedAxis === 'width' ? undefined : widthPresetFor(width);
    if (preset) resolved.width = preset;
  }

  if (Object.hasOwn(rest, 'align')) {
    const { align, ...remainder } = rest;
    rest = remainder;
    const preset = ownedAxis === 'align' ? undefined : alignPresetFor(align);
    if (preset) resolved.align = preset;
  }

  return Object.keys(resolved).length > 0
    ? { attributes: rest, resolved }
    : { attributes: rest };
}

/** The minimum column count `narrow` ever shrinks to, regardless of how small `width` is. */
export const NARROW_MINIMUM = 20;

/** The widest line already present in `block`, or `1` for an empty block (never a zero-width target). */
function maxLineWidth(block: string): number {
  let max = 0;
  for (const line of block.split('\n')) max = Math.max(max, measure(line));
  return max || 1;
}

/**
 * Turns `layout`'s resolved presets into an actual re-wrapped, aligned
 * block, given `width` columns of budget. Mapping (all documented here,
 * the one place it is decided): `narrow` halves `width` (rounded, never
 * below `NARROW_MINIMUM`); `wide` and `full` both use the entire `width`
 * (a terminal has no notion of "wider than the column" to distinguish
 * them); `fit` shrinks to `block`'s own widest existing line, never wider
 * than `width`. `align` then places the (possibly narrowed) block within
 * the full `width` using `./box.js`'s `pad`, which is where `align`'s
 * `left`/`center`/`right` meaning comes from — this function invents none
 * of its own.
 */
export function applyLayout(
  block: string,
  layout: ResolvedLayoutPresets | undefined,
  width: number,
): string {
  if (!layout) return block;

  let target = width;
  if (layout.width === 'narrow') {
    target = Math.max(NARROW_MINIMUM, Math.round(width / 2));
  } else if (layout.width === 'fit') {
    target = Math.min(width, maxLineWidth(block));
  }

  const narrowed =
    target < width
      ? block
          .split('\n')
          .flatMap((line) => wrap(line, Math.max(1, target)))
          .join('\n')
      : block;

  if (!layout.align) return narrowed;

  return narrowed
    .split('\n')
    .map((line) => pad(line, width, layout.align as AlignPreset))
    .join('\n');
}

/**
 * The target width a SELF-DRAWING box component (`card`, `callout`, `table`,
 * `chart`; see `registry.ts`'s `AnsiRegistryEntry.selfLayout`) should draw
 * its own frame at, given the resolved `width` preset. Mirrors the width
 * half of `applyLayout`'s mapping exactly (`narrow` halves `width`, floored
 * at `NARROW_MINIMUM`; `wide`/`full`/absent use the whole budget; `fit`
 * shrinks to the box's own natural content width, capped at `width`), so a
 * component that draws at this width up front needs no further narrowing:
 * `applyLayout`'s `wrap` step becomes a no-op on an already-correctly-sized
 * line. `naturalWidth` is the box's own widest line at its full content size
 * (only consulted for `fit`); a caller that draws lazily may pass a function
 * to defer that measurement until it is known to matter.
 */
export function selfLayoutWidth(
  layout: ResolvedLayoutPresets | undefined,
  width: number,
  naturalWidth: number | (() => number),
): number {
  if (!layout?.width) return width;
  if (layout.width === 'narrow') {
    return Math.max(NARROW_MINIMUM, Math.round(width / 2));
  }
  if (layout.width === 'fit') {
    const natural =
      typeof naturalWidth === 'function' ? naturalWidth() : naturalWidth;
    return Math.min(width, Math.max(1, natural));
  }
  return width;
}

/**
 * Pads a SELF-DRAWING box's already-drawn frame (every line already
 * `boxWidth` columns wide) within the full `width` per the resolved `align`
 * preset — the align half of `applyLayout`, factored out so a `selfLayout`
 * component can align its own frame without going through the generic
 * narrow/wrap path that would otherwise re-wrap (and corrupt) its
 * box-drawing characters. A no-op when `layout.align` is absent.
 */
export function selfLayoutAlign(
  block: string,
  layout: ResolvedLayoutPresets | undefined,
  width: number,
): string {
  if (!layout?.align) return block;
  return block
    .split('\n')
    .map((line) => pad(line, width, layout.align as AlignPreset))
    .join('\n');
}
