import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultAnsiTheme } from './theme.js';

/**
 * `doc.css`'s Tier 1 token block is the one contract every host theme layer
 * and this engine's `AnsiTheme` must cover. This test parses that block the
 * same brace-depth way `apps/obsidian/src/theme-coverage.test.ts` does, and
 * fails whenever `defaultAnsiTheme` is missing an entry for a token
 * `doc.css` declares (AGENTS.md's "New Tier 1 token" maintenance rule,
 * applied to a color model instead of a stylesheet).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS_PATH = path.resolve(here, '../../markii-react/src/doc.css');

interface TopLevelBlock {
  selector: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

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

describe('defaultAnsiTheme Tier 1 token coverage', () => {
  const docCss = readFileSync(DOC_CSS_PATH, 'utf8');

  it('found a non-trivial number of Tier 1 tokens (sanity check that the parser is actually matching doc.css)', () => {
    expect(tier1TokenNames(docCss).size).toBeGreaterThan(10);
  });

  it('declares every Tier 1 token doc.css defines', () => {
    const tokens = tier1TokenNames(docCss);
    const declared = new Set(Object.keys(defaultAnsiTheme));

    const missing = [...tokens].filter((token) => !declared.has(token)).sort();

    expect(
      missing,
      missing.length > 0
        ? `defaultAnsiTheme does not declare the following doc.css Tier 1 token(s): ${missing.join(', ')}`
        : undefined,
    ).toEqual([]);
  });

  it('self-test: the coverage mechanism actually flags a genuinely uncovered token', () => {
    const fakeDocCss = '.doc { --mk-bg: #fff; --mk-made-up: #123456; }';
    const tokens = tier1TokenNames(fakeDocCss);
    const declared = new Set(Object.keys(defaultAnsiTheme));
    expect(tokens.has('--mk-made-up')).toBe(true);
    expect(declared.has('--mk-made-up')).toBe(false);
  });
});
