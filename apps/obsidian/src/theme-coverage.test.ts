import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS_PATH = path.resolve(
  here,
  '../../../packages/platforms/markii-react/src/doc.css',
);
const THEME_CSS_PATH = path.resolve(here, 'obsidian-theme.css');

/**
 * `doc.css` now exposes its whole theming surface as a small Tier 1 token
 * contract (its own "TIER 1 TOKENS" comment block) instead of ~54
 * individually-colored selectors: every finer shade is derived from these
 * tokens via `color-mix()`, so a host that remaps the tokens gets every
 * component right for free. This test's only job is confirming
 * `obsidian-theme.css` actually redeclares each one — the drift alarm that
 * keeps this file honest as `doc.css` grows new tokens. Mirrors
 * `apps/vscode/src/webview/theme-coverage.test.ts`.
 *
 * This replaces the old per-selector coverage test (which asserted every
 * hardcoded-color selector in `doc.css` was re-declared here, and which
 * used a `THEME_NEUTRAL_SELECTORS` allowlist for the rest); that invariant
 * no longer applies now that `doc.css` has no hardcoded component colors
 * left to re-declare (see `@markii/react`'s `doc-css-tokens.test.ts`, the
 * new home for that guarantee).
 */

interface TopLevelBlock {
  selector: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Splits `css` into its top-level blocks via brace-depth tracking, so a
 * nested block (an `@supports` rule containing ordinary rule blocks, as
 * `doc.css` now has) is returned as one block whose `body` includes its
 * nested content, rather than misparsed by a flat, non-nesting splitter.
 */
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

/** Every `--mk-*` custom property name declared directly (no nesting) in `body`. */
function customPropertyNames(body: string): Set<string> {
  const names = new Set<string>();
  const pattern = /(--mk-[a-z0-9-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}

/** The Tier 1 token names `doc.css` declares, read from its own token-definition block (the `.doc` block that sets `--mk-bg`). */
function tier1TokenNames(docCss: string): Set<string> {
  const blocks = findTopLevelBlocks(stripComments(docCss));
  const tier1Block = blocks.find(
    (b) => b.selector === '.doc' && /--mk-bg\s*:/.test(b.body),
  );
  if (!tier1Block) {
    throw new Error(
      'could not find the Tier 1 token-definition block in doc.css',
    );
  }
  return customPropertyNames(tier1Block.body);
}

/** Every `--mk-*` custom property `css` declares anywhere (any block, any depth) — a host theme layer is free to set tokens at any selector, so this scans the whole file rather than one block. */
function declaredCustomProperties(css: string): Set<string> {
  return customPropertyNames(stripComments(css));
}

describe('obsidian-theme.css Tier 1 token coverage', () => {
  const docCss = readFileSync(DOC_CSS_PATH, 'utf8');
  const themeCss = readFileSync(THEME_CSS_PATH, 'utf8');

  it('found a non-trivial number of Tier 1 tokens (sanity check that the parser is actually matching doc.css)', () => {
    expect(tier1TokenNames(docCss).size).toBeGreaterThan(10);
  });

  it('redeclares every Tier 1 token doc.css defines', () => {
    const tokens = tier1TokenNames(docCss);
    const declared = declaredCustomProperties(themeCss);

    const missing = [...tokens].filter((token) => !declared.has(token)).sort();

    expect(
      missing,
      missing.length > 0
        ? `obsidian-theme.css does not redeclare the following doc.css Tier 1 token(s): ${missing.join(', ')}`
        : undefined,
    ).toEqual([]);
  });

  it('self-test: the coverage mechanism actually flags a genuinely uncovered token', () => {
    const fakeDocCss = '.doc { --mk-bg: #fff; --mk-made-up: #123456; }';
    const fakeThemeCss = '.doc { --mk-bg: var(--background-primary); }';
    const tokens = tier1TokenNames(fakeDocCss);
    const declared = declaredCustomProperties(fakeThemeCss);
    expect(tokens.has('--mk-made-up')).toBe(true);
    expect(declared.has('--mk-made-up')).toBe(false);
  });

  it('self-test: a token redeclared anywhere in the theme sheet is recognized as covered', () => {
    const fakeDocCss = '.doc { --mk-bg: #fff; --mk-fg: #000; }';
    const fakeThemeCss =
      '.doc { --mk-bg: var(--background-primary); --mk-fg: var(--text-normal); }';
    const tokens = tier1TokenNames(fakeDocCss);
    const declared = declaredCustomProperties(fakeThemeCss);
    expect([...tokens].every((t) => declared.has(t))).toBe(true);
  });

  it('self-test: the parser handles nested @supports content correctly', () => {
    const fake = `
      .doc { --mk-bg: #fff; }
      @supports (color: color-mix(in srgb, red, red)) {
        .doc { --mk-info-fill: color-mix(in srgb, red 10%, blue); }
      }
    `;
    const blocks = findTopLevelBlocks(stripComments(fake));
    expect(blocks).toHaveLength(2);
    const supports = blocks.find((b) => b.selector.startsWith('@supports'));
    expect(supports?.body).toContain('--mk-info-fill');
  });
});
