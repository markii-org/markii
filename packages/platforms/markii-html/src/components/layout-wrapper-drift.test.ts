import { describe, expect, it } from 'vitest';
import { ALIGN_PRESETS, WIDTH_PRESETS } from '@markii/stdlib';
import { resolveLayoutAttributes } from '../layout.js';
import { createTestContext } from '../test/html-context.js';
import {
  createLayoutWrapper,
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

  it('sanity: the comparison is not vacuous', () => {
    expect(LAYOUT_WRAPPER_PRESETS.length).toBeGreaterThan(0);
    expect(attributeClass('width', 'fit')).toBe('mk-width-fit');
    expect(attributeClass('align', 'right')).toBe('mk-align-right');
  });
});
