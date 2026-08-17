import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS_PATH = path.resolve(
  here,
  '../../../../packages/platforms/markii-react/src/doc.css',
);
const THEME_CSS_PATH = path.resolve(here, 'theme.css');

/**
 * Selectors intentionally left WITHOUT a `theme.css` override, because their
 * `doc.css` color already reads correctly against any VS Code theme as-is.
 * Empty today — every hardcoded-color selector currently found in `doc.css`
 * has a themed override below. Add an entry here (with a one-line reason)
 * only for a genuinely theme-invariant color; prefer an override otherwise.
 */
export const THEME_NEUTRAL_SELECTORS: readonly string[] = [];

/** A property name this test cares about: any color-bearing CSS property, or an `@markii/react` `--mk-*` custom property. */
const COLOR_PROP_PATTERN =
  /^(color|background|background-color|border(-[a-z]+)*|fill|stroke|--mk-[a-z-]+)$/i;

/** `#rgb`/`#rrggbb`(`aa`) — doc.css uses only 3- and 6-digit hex, but this is deliberately a little generous. */
const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * A DELIBERATELY DUMB CSS block splitter — this is a drift alarm, not a CSS
 * engine. It matches `<selector list> { <declarations> }` via a
 * brace-balance-naive regex, which is only sound because every rule body in
 * both `doc.css` and `theme.css` is flat (no nested rules, no `@media`
 * blocks containing color declarations, no strings containing braces). It
 * does not need to be more than that: its ONE job is finding which
 * selectors set a hardcoded hex color on a color-ish property.
 */
function extractRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selector) rules.push({ selector, body });
  }
  return rules;
}

/** Splits a comma-separated selector list into individually-checkable selectors, whitespace-normalized so multiline groups in `doc.css` compare equal to however `theme.css` happens to format the same list. */
function splitSelectors(selectorList: string): string[] {
  return selectorList
    .split(',')
    .map((selector) => selector.trim().replace(/\s+/g, ' '))
    .filter((selector) => selector.length > 0);
}

/** True if any declaration in `body` sets a color-ish property to a value containing a hardcoded hex literal. */
function bodyHasHardcodedColor(body: string): boolean {
  return body.split(';').some((declaration) => {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) return false;
    const prop = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1);
    return COLOR_PROP_PATTERN.test(prop) && HEX_COLOR_PATTERN.test(value);
  });
}

/** Every individual selector `css` sets a hardcoded hex color on, via a color-ish property (comma-groups split apart — see `splitSelectors`). */
function hardcodedColorSelectors(css: string): Set<string> {
  const selectors = new Set<string>();
  for (const rule of extractRules(stripComments(css))) {
    if (!bodyHasHardcodedColor(rule.body)) continue;
    for (const selector of splitSelectors(rule.selector)) {
      selectors.add(selector);
    }
  }
  return selectors;
}

/** Every individual selector `css` declares ANY rule for — body content doesn't matter here, presence in `theme.css` is the override signal. */
function declaredSelectors(css: string): Set<string> {
  const selectors = new Set<string>();
  for (const rule of extractRules(stripComments(css))) {
    for (const selector of splitSelectors(rule.selector)) {
      selectors.add(selector);
    }
  }
  return selectors;
}

describe('theme.css color coverage', () => {
  const docCss = readFileSync(DOC_CSS_PATH, 'utf8');
  const themeCss = readFileSync(THEME_CSS_PATH, 'utf8');

  it('found a non-trivial number of hardcoded-color selectors (sanity check that the parser is actually matching doc.css)', () => {
    expect(hardcodedColorSelectors(docCss).size).toBeGreaterThan(10);
  });

  it('overrides, or explicitly allowlists, every hardcoded-color selector in doc.css', () => {
    const hardcoded = hardcodedColorSelectors(docCss);
    const overridden = declaredSelectors(themeCss);
    const allowlisted = new Set(THEME_NEUTRAL_SELECTORS);

    const uncovered = [...hardcoded]
      .filter(
        (selector) => !overridden.has(selector) && !allowlisted.has(selector),
      )
      .sort();

    expect(uncovered).toEqual([]);
  });

  it('has no stale allowlist entries (every allowlisted selector genuinely appears in doc.css)', () => {
    const hardcoded = hardcodedColorSelectors(docCss);
    for (const selector of THEME_NEUTRAL_SELECTORS) {
      expect(hardcoded.has(selector)).toBe(true);
    }
  });

  it('self-test: the coverage mechanism actually flags a genuinely uncovered selector', () => {
    const fakeDocCss = '.made-up-selector { color: #123456; }';
    const fakeThemeCss = '.something-else { color: red; }';
    const hardcoded = hardcodedColorSelectors(fakeDocCss);
    const overridden = declaredSelectors(fakeThemeCss);
    expect(hardcoded.has('.made-up-selector')).toBe(true);
    expect(overridden.has('.made-up-selector')).toBe(false);
  });

  it('self-test: a matching selector in the override sheet is recognized as covered', () => {
    const fakeDocCss = '.made-up-selector { color: #123456; }';
    const fakeThemeCss = '.made-up-selector { color: var(--mkv-fg); }';
    const hardcoded = hardcodedColorSelectors(fakeDocCss);
    const overridden = declaredSelectors(fakeThemeCss);
    expect([...hardcoded].every((selector) => overridden.has(selector))).toBe(
      true,
    );
  });

  it('self-test: a non-color property (e.g. box-shadow rgba, grid-template-columns) is not flagged', () => {
    const fakeDocCss =
      '.x { box-shadow: inset 0 -1px 0 rgba(0,0,0,0.05); grid-template-columns: 1fr; }';
    expect(hardcodedColorSelectors(fakeDocCss).size).toBe(0);
  });
});
