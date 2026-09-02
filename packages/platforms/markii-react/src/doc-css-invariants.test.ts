import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS_PATH = path.resolve(here, 'doc.css');

/**
 * Executable coverage for docs/spec.md §9's S3-01 ("a component MUST NOT
 * set outer margins") and S3-02 ("component text MUST NOT wrap around
 * floated content") — Architecture rule 4 in AGENTS.md ("Components own
 * their insides only: no outer margins on any component; the document
 * stylesheet owns vertical rhythm"). Neither invariant had an executable
 * test before this file: `doc-css-tokens.test.ts` only scans for hardcoded
 * color literals against the Tier 1 palette contract, and says nothing
 * about margins or floats.
 *
 * This is a static parse of `doc.css`, not a rendered-DOM measurement —
 * matching `doc-css-tokens.test.ts`'s own approach for the same reason: the
 * invariant is about what the STYLESHEET declares, and a parse fails the
 * instant a forbidden declaration is typed, before it ever reaches a
 * browser.
 */

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface TopLevelBlock {
  selector: string;
  body: string;
}

/** Splits `css` into top-level `{ selector, body }` blocks via brace-depth tracking (an `@supports` block's nested rules stay inside its own `body`, unparsed further — this file's checks never need to reach into one). */
function findTopLevelBlocks(css: string): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  let depth = 0;
  let selectorStart = 0;
  let openIdx = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) openIdx = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && openIdx !== -1) {
        const selector = css.slice(selectorStart, openIdx).trim();
        const body = css.slice(openIdx + 1, i);
        blocks.push({ selector, body });
        selectorStart = i + 1;
        openIdx = -1;
      }
    }
  }
  return blocks;
}

function loadDocCss(): string {
  return stripComments(readFileSync(DOC_CSS_PATH, 'utf8'));
}

/**
 * A "component root" selector: a bare, single-element simple selector made
 * only of `.mk-*` classes chained with no combinator (` `, `>`, `+`, `~`),
 * no pseudo-class/attribute, and no BEM element separator (`__`). This is
 * exactly the outer box a component's own React/HTML implementation
 * renders (`.mk-callout`, `.mk-callout--danger`, `.mk-width-narrow`,
 * `.mk-layout.mk-align-center`, ...). A BEM *element* class
 * (`.mk-callout__body`) or anything scoped with a combinator
 * (`.mk-tab > * + *`, `.mk-details[open] > .mk-details__summary`) targets a
 * DESCENDANT the component owns — its own "insides" — which Architecture
 * rule 4 explicitly leaves to the component, so those are out of scope
 * here by construction rather than by an exception list.
 */
function isComponentRootSelector(selector: string): boolean {
  if (selector.includes('__')) return false;
  if (/[\s>+~:[]/.test(selector)) return false;
  return /^(\.mk-[a-z0-9-]+)+$/i.test(selector);
}

/**
 * The margin-family longhand/shorthand property names. `margin-inline`
 * (plain, not `-start`/`-end`) is included too: even though this file only
 * ever uses it for `auto` centering today, a literal inline value on a
 * component root would be exactly the kind of outer spacing S3-01 forbids.
 */
const MARGIN_PROPERTY =
  /\bmargin(?:-(?:block|inline))?(?:-(?:start|end|top|right|bottom|left))?\s*:\s*([^;]+)/gi;

/** Whether every space/comma-separated term in a margin value is a zero length (`0`, `0px`, `0rem`, ...) — a reset, not spacing. `auto` and any non-zero length are NOT all-zero. */
function isAllZero(value: string): boolean {
  const terms = value.trim().split(/\s+/);
  if (terms.length === 0) return false;
  return terms.every((term) => /^0(?:[a-z%]+)?$/i.test(term));
}

/**
 * The layout system's own alignment/rhythm rules (docs/format.md's
 * `width=`/`align=` presets and `:::center`/`:::left`/... wrappers) are the
 * ONE place outside the document rhythm rule itself that legitimately sets
 * a margin on what looks like a component-root selector: `align=` moves a
 * narrower-than-column box with `margin-inline: auto`/`margin-inline-start:
 * auto`/`margin-inline-end: auto`, and `.mk-layout > * + *` restores rhythm
 * INSIDE a layout wrapper's own scope (doc.css's own comment above that
 * rule explains why: `.doc > * + *` only ever sees the wrapper as a whole).
 * Every one of these is documented in `doc.css` itself; nothing here is a
 * silent carve-out.
 */
const ALLOWED_MARGIN_SELECTORS = new Set([
  '.mk-align-left',
  '.mk-align-center',
  '.mk-align-right',
]);

describe('doc.css: S3-01 — a component sets no outer margin (docs/spec.md §9)', () => {
  const css = loadDocCss();
  const blocks = findTopLevelBlocks(css);

  // Every component-root selector actually found, purely so a future
  // component addition is guaranteed to be checked rather than silently
  // missed by a typo in `isComponentRootSelector`'s pattern.
  const rootSelectorsSeen = new Set<string>();

  for (const block of blocks) {
    for (const rawSelector of block.selector.split(',')) {
      const selector = rawSelector.trim();
      if (!isComponentRootSelector(selector)) continue;
      rootSelectorsSeen.add(selector);
    }
  }

  it('found component-root selectors to check (the scan itself is not vacuous)', () => {
    expect(rootSelectorsSeen.size).toBeGreaterThan(10);
    expect(rootSelectorsSeen.has('.mk-callout')).toBe(true);
    expect(rootSelectorsSeen.has('.mk-table')).toBe(true);
  });

  for (const block of blocks) {
    const selectors = block.selector
      .split(',')
      .map((s) => s.trim())
      .filter(isComponentRootSelector);
    if (selectors.length === 0) continue;

    for (const selector of selectors) {
      if (ALLOWED_MARGIN_SELECTORS.has(selector)) continue;

      it(`${selector} declares no non-zero outer margin`, () => {
        const violations: string[] = [];
        let match: RegExpExecArray | null;
        MARGIN_PROPERTY.lastIndex = 0;
        while ((match = MARGIN_PROPERTY.exec(block.body)) !== null) {
          const value = match[1] ?? '';
          if (!isAllZero(value)) violations.push(match[0].trim());
        }
        expect(violations).toEqual([]);
      });
    }
  }
});

describe('doc.css: S3-02 — component text does not wrap around floated content (docs/spec.md §9)', () => {
  const css = loadDocCss();
  const blocks = findTopLevelBlocks(css);

  it('no rule anywhere in doc.css declares `float`', () => {
    const offenders = blocks
      .filter((block) => /\bfloat\s*:\s*(left|right)\b/i.test(block.body))
      .map((block) => block.selector);
    expect(offenders).toEqual([]);
  });
});
