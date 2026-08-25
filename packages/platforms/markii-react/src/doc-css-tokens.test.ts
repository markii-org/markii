import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS_PATH = path.resolve(here, 'doc.css');

/**
 * `doc.css`'s theming contract (see the file's own "TIER 1 TOKENS" comment
 * block): every host remaps these ~14 custom properties on `.doc` instead
 * of overriding dozens of individual selectors. This test is the invariant
 * that keeps that contract real: no component rule anywhere in the file may
 * hardcode a color literal again, because that would silently reintroduce
 * exactly the per-selector drift the token layer exists to eliminate.
 *
 * The only places a literal color is legitimate:
 *   1. The Tier 1 token-definition block (`.doc { --mk-bg: #fff; ... }`) —
 *      the tokens THEMSELVES have to start somewhere.
 *   2. The `@supports (color: color-mix(...))` guard's literal fallback
 *      block, which exists specifically so an email client without
 *      `color-mix` support gets today's real light-mode colors instead of
 *      an invalid, vanished declaration (see the file's own comment on
 *      this).
 * Everywhere else, a color must be a `var(--mk-*)` reference (directly or
 * through a component-local `--mk-*-bg`/`--mk-*-fg` variable), never a
 * literal.
 */

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface TopLevelBlock {
  selector: string;
  body: string;
  start: number;
  end: number;
}

/**
 * Splits `css` into its TOP-LEVEL blocks via brace-depth tracking, so a
 * nested block (an `@supports` rule containing ordinary rule blocks, as
 * `doc.css` now has) is returned as ONE block whose `body` includes its
 * nested content — unlike the old flat, non-nesting selector/body splitter
 * this replaces, which would have misparsed `@supports` entirely.
 */
function findTopLevelBlocks(css: string): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  let depth = 0;
  let selectorStart = 0;
  let openIdx = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        openIdx = i;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && openIdx !== -1) {
        const selector = css.slice(selectorStart, openIdx).trim();
        const body = css.slice(openIdx + 1, i);
        blocks.push({ selector, body, start: selectorStart, end: i + 1 });
        selectorStart = i + 1;
        openIdx = -1;
      }
    }
  }
  return blocks;
}

/** Names of every `--mk-*` custom property declared directly in `body` (no nesting expected here). */
function customPropertyNames(body: string): string[] {
  const names: string[] = [];
  const pattern = /(--mk-[a-z0-9-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

/** `#rgb`/`#rrggbb`(`aa`), `rgb()`/`rgba()`, `hsl()`/`hsla()`, or a handful of common CSS named colors — deliberately excludes `transparent`/`currentColor`/`inherit`, which are theme-neutral keywords rather than colors needing remapping. */
const RAW_COLOR_PATTERN =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown|cyan|magenta|navy|teal|maroon|olive|silver|gold|indigo|violet|coral|salmon)\b/i;

function loadDocCss(): { raw: string; stripped: string } {
  const raw = readFileSync(DOC_CSS_PATH, 'utf8');
  return { raw, stripped: stripComments(raw) };
}

describe('doc.css token architecture', () => {
  const { stripped } = loadDocCss();
  const blocks = findTopLevelBlocks(stripped);

  const tier1Block = blocks.find(
    (b) => b.selector === '.doc' && /--mk-bg\s*:/.test(b.body),
  );
  const fallbackBlock = blocks.find(
    (b) =>
      b.selector === '.doc' &&
      /--mk-info-fill\s*:/.test(b.body) &&
      !/--mk-bg\s*:/.test(b.body),
  );
  const supportsBlock = blocks.find((b) => b.selector.startsWith('@supports'));

  it('finds the Tier 1 token-definition block', () => {
    expect(tier1Block).toBeDefined();
  });

  it('finds the @supports literal-fallback block and the guarded color-mix block', () => {
    expect(fallbackBlock).toBeDefined();
    expect(supportsBlock).toBeDefined();
    expect(supportsBlock?.selector).toContain('color-mix');
  });

  it('declares exactly the 14 Tier 1 tokens, no more, no fewer', () => {
    const names = tier1Block ? customPropertyNames(tier1Block.body) : [];
    expect(new Set(names)).toEqual(
      new Set([
        '--mk-bg',
        '--mk-raised',
        '--mk-fg',
        '--mk-surface',
        '--mk-surface-strong',
        '--mk-border',
        '--mk-muted',
        '--mk-faint',
        '--mk-accent',
        '--mk-on-accent',
        '--mk-info',
        '--mk-success',
        '--mk-warning',
        '--mk-danger',
        '--mk-limit',
      ]),
    );
  });

  it('the @supports fallback block contains real literal hex colors, not empty placeholders', () => {
    expect(fallbackBlock?.body).toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('contains no raw color literal anywhere outside the token-definition block and the @supports fallback block', () => {
    if (!tier1Block || !fallbackBlock || !supportsBlock) {
      throw new Error('expected token/fallback/@supports blocks to exist');
    }
    // Remove the three allowed spans (by descending start index, so earlier
    // removals don't shift the indices of ones still pending) and scan
    // whatever remains.
    const spans = [tier1Block, fallbackBlock, supportsBlock]
      .map((b) => [b.start, b.end] as const)
      .sort((a, b) => b[0] - a[0]);
    let remainder = stripped;
    for (const [start, end] of spans) {
      remainder = remainder.slice(0, start) + remainder.slice(end);
    }

    const offenders = remainder
      .split('\n')
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => RAW_COLOR_PATTERN.test(line));

    expect(
      offenders,
      offenders.length > 0
        ? `doc.css has a raw color literal outside the token/@supports blocks at line(s): ${offenders
            .map((o) => `${String(o.index + 1)}: ${o.line}`)
            .join('; ')}`
        : undefined,
    ).toEqual([]);
  });

  it('self-test: the parser handles nested @supports content correctly (sanity check against the old flat-parser assumption)', () => {
    const fake = `
      .a { color: #111111; }
      @supports (color: color-mix(in srgb, red, red)) {
        .b { color: color-mix(in srgb, red 10%, blue); }
        .c { color: var(--x); }
      }
      .d { color: #222222; }
    `;
    const fakeBlocks = findTopLevelBlocks(fake);
    const supports = fakeBlocks.find((b) => b.selector.startsWith('@supports'));
    expect(supports).toBeDefined();
    expect(supports?.body).toContain('.b { color: color-mix');
    expect(supports?.body).toContain('.c { color: var(--x); }');
    // Only 3 top-level blocks: .a, @supports (as one block), .d
    expect(fakeBlocks).toHaveLength(3);
  });

  it('self-test: the raw-color-literal check actually flags hex/rgb/hsl/named colors', () => {
    expect(RAW_COLOR_PATTERN.test('color: #abc123;')).toBe(true);
    expect(RAW_COLOR_PATTERN.test('color: rgba(0, 0, 0, 0.5);')).toBe(true);
    expect(RAW_COLOR_PATTERN.test('color: hsl(200, 50%, 50%);')).toBe(true);
    expect(RAW_COLOR_PATTERN.test('color: red;')).toBe(true);
    expect(RAW_COLOR_PATTERN.test('color: var(--mk-fg);')).toBe(false);
    expect(RAW_COLOR_PATTERN.test('border-color: transparent;')).toBe(false);
  });
});
