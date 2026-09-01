import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALIGN_PRESETS,
  TEXT_ALIGN_PRESETS,
  WIDTH_PRESETS,
  layoutWrapperAxis,
  otherLayoutAxis,
} from '@markii/stdlib';

/**
 * Every layout preset must have a rule in `doc.css`, the stylesheet both
 * renderers share. A preset added to `@markii/stdlib`'s vocabulary picks up
 * a class name mechanically in both class maps, so it starts completing,
 * inserting, and rendering the moment it is listed. If nobody writes the
 * matching CSS, all of that still "works" and the block simply looks
 * unchanged: a failure with no marker and no diagnostic, which is the mute
 * failure AGENTS.md rules out. This suite is the executable version of that
 * rule.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const docCss = readFileSync(path.resolve(here, 'doc.css'), 'utf8');

/** Whether `doc.css` carries a rule whose selector uses `.className`. */
function hasRuleFor(className: string): boolean {
  // A selector occurrence followed by something that cannot continue an
  // identifier, so `.mk-width-full` never satisfies a search for
  // `.mk-width-fu`. Comment text is not a rule, so require the class to be
  // followed by selector or block punctuation.
  const pattern = new RegExp(`\\.${className}(?![\\w-])\\s*[,{:>+~]`);
  return pattern.test(docCss);
}

describe('doc.css covers every layout preset class', () => {
  it.each(ALIGN_PRESETS)('defines a rule for .mk-align-%s', (preset) => {
    expect(hasRuleFor(`mk-align-${preset}`)).toBe(true);
  });

  it.each(WIDTH_PRESETS.filter((preset) => preset !== 'normal'))(
    'defines a rule for .mk-width-%s',
    (preset) => {
      expect(hasRuleFor(`mk-width-${preset}`)).toBe(true);
    },
  );

  it('deliberately defines no .mk-width-normal, the classless default', () => {
    expect(hasRuleFor('mk-width-normal')).toBe(false);
  });

  it('defines the wrapper-only .mk-layout rules', () => {
    expect(hasRuleFor('mk-layout')).toBe(true);
  });

  it.each(TEXT_ALIGN_PRESETS)('defines a rule for .mk-text-%s', (preset) => {
    // Same argument as the layout presets above: `text` is offered by
    // completion and emitted by both engines the moment the value is
    // listed, so a missing rule would be a silently ignored attribute.
    expect(hasRuleFor(`mk-text-${preset}`)).toBe(true);
  });

  it.each(ALIGN_PRESETS)(
    'gives the :::%s wrapper a declared text-align, not only a box-placement rule',
    (preset) => {
      // `.mk-align-*` on its own only moves the box (auto margins). An
      // alignment WRAPPER also sets text alignment in scope (docs/spec.md
      // §3), and `left` needs it most: it is the wrapper written to undo an
      // alignment inherited from an enclosing `:::row{text=...}`, and only a
      // declared value beats an inherited one.
      const pattern = new RegExp(
        `\\.mk-layout\\.mk-align-${preset}\\s*\\{[^}]*text-align`,
      );
      expect(pattern.test(docCss)).toBe(true);
    },
  );

  it('a wrapper class composes with the class of its OPEN axis, both defined here', () => {
    // `:::center{width=fit}` emits one div carrying `mk-layout
    // mk-align-center mk-width-fit`, so every wrapper's own class AND the
    // class its open axis can contribute must both exist in this stylesheet.
    for (const preset of [
      ...ALIGN_PRESETS,
      ...WIDTH_PRESETS.filter((p) => p !== 'normal'),
    ]) {
      const ownAxis = layoutWrapperAxis(preset);
      if (ownAxis === undefined) {
        throw new Error(`"${preset}" is not a layout-wrapper name`);
      }
      const openAxis = otherLayoutAxis(ownAxis);
      const openValues =
        openAxis === 'align'
          ? ALIGN_PRESETS
          : WIDTH_PRESETS.filter((p) => p !== 'normal');
      expect(hasRuleFor(`mk-${ownAxis}-${preset}`), preset).toBe(true);
      for (const value of openValues) {
        expect(hasRuleFor(`mk-${openAxis}-${value}`), value).toBe(true);
      }
    }
  });

  it('carries no rule that overloads align on a row to mean content alignment', () => {
    // Removed in favor of `text` (docs/spec.md §3): `align` on a row now
    // means what it means everywhere else. Asserted here, not only in
    // row.test.tsx, because this suite is where the layout stylesheet's
    // shape is pinned.
    expect(docCss).not.toContain('> .mk-row');
  });

  it('self-test: the selector search rejects a class that is not there', () => {
    // Without this, a broken regex would pass every assertion above.
    expect(hasRuleFor('mk-width-nonexistent')).toBe(false);
    expect(hasRuleFor('mk-align')).toBe(false);
  });
});
