import { describe, expect, it } from 'vitest';
import {
  ALIGN_PRESETS,
  TEXT_ALIGN_PRESETS,
  WIDTH_PRESETS,
  layoutWrapperAxis,
  otherLayoutAxis,
} from '@markii/stdlib';
import { resolveLayoutAttributes } from '../layout.js';
import { createTestContext } from '../test/html-context.js';
import { withTextClass } from '../layout.js';
import {
  createLayoutWrapper,
  layoutWrapperPresetAxis,
  LAYOUT_WRAPPER_PRESETS,
} from './layout-wrapper.js';

/**
 * The string engine's half of the wrapper/attribute drift guard, mirroring
 * `@markii/react`'s `layout-wrapper-drift.test.tsx`. This engine keeps its
 * own hand-written `WRAPPER_CLASSES` map so its markup can match the React
 * renderer byte-for-byte, which is exactly the kind of second copy that
 * drifts, so the same invariant is asserted here: a wrapper is `mk-layout`
 * plus the class its matching `width=`/`align=` attribute resolves to,
 * read back through the public attribute path rather than off the map.
 */

const ctx = createTestContext();

function attributeClass(key: 'width' | 'align', preset: string): string {
  const resolved = resolveLayoutAttributes({ [key]: preset });
  expect(
    resolved.className,
    `${key}=${preset} resolved to no class at all`,
  ).toBeDefined();
  return resolved.className ?? '';
}

const ALIGN_PRESET_SET: ReadonlySet<string> = new Set(ALIGN_PRESETS);

describe('layout wrappers compose from the layout attribute classes', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    ':::%s is mk-layout plus the class its matching attribute resolves to',
    (preset) => {
      const key = ALIGN_PRESET_SET.has(preset) ? 'align' : 'width';
      expect(createLayoutWrapper(preset)({}, 'x', ctx)).toBe(
        `<div class="mk-layout ${attributeClass(key, preset)}">x</div>`,
      );
    },
  );

  it('names exactly the align presets plus every non-default width preset', () => {
    const expected = [
      ...ALIGN_PRESETS,
      ...WIDTH_PRESETS.filter((preset) => preset !== 'normal'),
    ].sort();
    expect([...LAYOUT_WRAPPER_PRESETS].sort()).toEqual(expected);
  });

  it.each(LAYOUT_WRAPPER_PRESETS)(
    ':::%s composed with its open axis is its own class plus the attribute class, on one element',
    (preset) => {
      const own = layoutWrapperPresetAxis(preset);
      const open = otherLayoutAxis(own);
      const openValue = open === 'align' ? 'center' : 'fit';
      const ownClass = attributeClass(own, preset);
      const openClass = attributeClass(open, openValue);
      const withLayout = createTestContext({ layoutClassName: openClass });
      expect(createLayoutWrapper(preset)({}, 'x', withLayout)).toBe(
        `<div class="mk-layout ${ownClass} ${openClass}">x</div>`,
      );
    },
  );

  it('layoutWrapperPresetAxis agrees with @markii/stdlib for every preset', () => {
    for (const preset of LAYOUT_WRAPPER_PRESETS) {
      expect(layoutWrapperPresetAxis(preset), preset).toBe(
        layoutWrapperAxis(preset),
      );
    }
  });

  it('withTextClass maps every text preset to mk-text-<value> and nothing else', () => {
    // The `text` classes are a second copy in this engine, exactly like
    // `WRAPPER_CLASSES` is, so they get the same drift guard: derived from
    // `@markii/stdlib`'s vocabulary, compared against what the component
    // helper actually emits.
    for (const preset of TEXT_ALIGN_PRESETS) {
      expect(withTextClass('base', preset)).toBe(`base mk-text-${preset}`);
    }
    expect(withTextClass('base', 'diagonal')).toBe('base');
    expect(withTextClass('base', undefined)).toBe('base');
    expect(withTextClass('base', null)).toBe('base');
  });

  it('sanity: the comparison is not vacuous', () => {
    expect(LAYOUT_WRAPPER_PRESETS.length).toBeGreaterThan(0);
    expect(attributeClass('width', 'fit')).toBe('mk-width-fit');
    expect(attributeClass('align', 'right')).toBe('mk-align-right');
  });
});
