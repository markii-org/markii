import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALIGN_PRESETS, WIDTH_PRESETS } from '@markii/stdlib';

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

  it('self-test: the selector search rejects a class that is not there', () => {
    // Without this, a broken regex would pass every assertion above.
    expect(hasRuleFor('mk-width-nonexistent')).toBe(false);
    expect(hasRuleFor('mk-align')).toBe(false);
  });
});
