import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ALIGN_PRESETS,
  WIDTH_PRESETS,
  layoutWrapperAxis,
  otherLayoutAxis,
} from '@markii/stdlib';
import { resolveLayoutAttributes } from '../layout';
import { createLayoutWrapper, LAYOUT_WRAPPER_PRESETS } from './layout-wrapper';

/**
 * Guards the layout WRAPPERS against drifting away from the layout
 * ATTRIBUTES they are supposed to be a second spelling of. A wrapper adds
 * `mk-layout` and then reuses the exact class the matching `width=`/
 * `align=` attribute would have produced, so `:::right` and
 * `{align=right}` cannot end up styled by two different class names.
 *
 * The expected class is read back through `resolveLayoutAttributes`, the
 * public attribute path, rather than off the private class maps: that way
 * this suite compares the wrapper against what the renderer ACTUALLY emits
 * for the attribute, not against a second copy of the same table.
 */

/** The class `{width=preset}` or `{align=preset}` resolves to on its own. */
function attributeClass(key: 'width' | 'align', preset: string): string {
  const resolved = resolveLayoutAttributes({ [key]: preset });
  expect(
    resolved.className,
    `${key}=${preset} resolved to no class at all`,
  ).toBeDefined();
  return resolved.className ?? '';
}

const ALIGN_PRESET_SET: ReadonlySet<string> = new Set(ALIGN_PRESETS);

function renderedClassName(
  preset: (typeof LAYOUT_WRAPPER_PRESETS)[number],
  layoutClassName?: string,
) {
  const Wrapper = createLayoutWrapper(preset);
  const { container } = render(
    <Wrapper attributes={{}} layoutClassName={layoutClassName}>
      x
    </Wrapper>,
  );
  return container.firstElementChild?.className;
}

/** The axis `preset` decides by its own name, and the one it leaves open. */
function axesOf(preset: string): {
  own: 'width' | 'align';
  open: 'width' | 'align';
} {
  const own = layoutWrapperAxis(preset);
  if (own === undefined) {
    throw new Error(`"${preset}" is not a layout-wrapper name`);
  }
  return { own, open: otherLayoutAxis(own) };
}

describe('layout wrappers compose from the layout attribute classes', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    ':::%s is mk-layout plus the class its matching attribute resolves to',
    (preset) => {
      const key = ALIGN_PRESET_SET.has(preset) ? 'align' : 'width';
      expect(renderedClassName(preset)).toBe(
        `mk-layout ${attributeClass(key, preset)}`,
      );
    },
  );

  it('has a wrapper for every align preset', () => {
    for (const preset of ALIGN_PRESETS) {
      expect(
        (LAYOUT_WRAPPER_PRESETS as readonly string[]).includes(preset),
        `no :::${preset} wrapper for align=${preset}`,
      ).toBe(true);
    }
  });

  it('has a wrapper for every width preset except the classless default', () => {
    for (const preset of WIDTH_PRESETS) {
      const expected = preset !== 'normal';
      expect(
        (LAYOUT_WRAPPER_PRESETS as readonly string[]).includes(preset),
        `:::${preset} wrapper presence did not match width=${preset}`,
      ).toBe(expected);
    }
  });

  it('names no wrapper that is not an align or a non-default width preset', () => {
    const allowed = new Set<string>([
      ...ALIGN_PRESETS,
      ...WIDTH_PRESETS.filter((preset) => preset !== 'normal'),
    ]);
    for (const preset of LAYOUT_WRAPPER_PRESETS) {
      expect(allowed.has(preset), `:::${preset} maps to no layout preset`).toBe(
        true,
      );
    }
  });

  it.each(LAYOUT_WRAPPER_PRESETS)(
    ':::%s composed with its open axis is its own class plus the attribute class, on one element',
    (preset) => {
      const { own, open } = axesOf(preset);
      const openValue = open === 'align' ? 'center' : 'fit';
      const ownClass = attributeClass(own, preset);
      const openClass = attributeClass(open, openValue);
      // `render.tsx` resolves the open axis through the very same
      // `resolveLayoutAttributes` path an ordinary directive uses, so the
      // composed class must be the wrapper's own plus exactly that class,
      // with nothing invented in between.
      expect(renderedClassName(preset, openClass)).toBe(
        `mk-layout ${ownClass} ${openClass}`,
      );
    },
  );

  it('sanity: the comparison is not vacuous', () => {
    // Every assertion above would pass trivially against an empty preset
    // list, and `attributeClass` would pass trivially if it returned ''.
    expect(LAYOUT_WRAPPER_PRESETS.length).toBeGreaterThan(0);
    expect(attributeClass('width', 'fit')).toBe('mk-width-fit');
    expect(attributeClass('align', 'right')).toBe('mk-align-right');
  });
});
