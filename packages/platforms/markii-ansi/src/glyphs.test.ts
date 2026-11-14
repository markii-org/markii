import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceDir } from '@markii/core/corpus';
import { renderMarkToAnsi } from './render.js';
import { BOX_STYLES, glyphsFor, type GlyphSet } from './glyphs.js';
import { measureWidth } from './text-grid.js';

/** Every character above 0x7f in `text`, so a failure names the offenders. */
function nonAscii(text: string): string[] {
  return [...text].filter((ch) => ch.charCodeAt(0) > 0x7f);
}

/** Every string a glyph set holds, flattened. */
function allGlyphs(set: GlyphSet): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) walk(inner);
    }
  };
  walk(set);
  return out;
}

/** The `.mk.md` inputs the ascii pass covers: the render corpus plus this engine's own nesting fixtures. Each is ASCII-only, so any non-ASCII byte in the output came from the engine. */
function corpusInputs(): { name: string; source: string }[] {
  const dirs = [
    join(conformanceDir(), 'render'),
    join(import.meta.dirname, '..', 'test-fixtures'),
  ];
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((entry) => entry.endsWith('.mk.md'))
      .sort()
      .map((entry) => ({
        name: entry,
        source: readFileSync(join(dir, entry), 'utf8'),
      })),
  );
}

describe('glyph table', () => {
  it('the ascii set is 7-bit throughout', () => {
    for (const glyph of allGlyphs(glyphsFor('ascii'))) {
      expect(nonAscii(glyph)).toEqual([]);
    }
  });

  it('both sets have the same shape, and layout-bearing glyphs the same width', () => {
    const unicode = glyphsFor('unicode');
    const ascii = glyphsFor('ascii');
    expect(Object.keys(ascii).sort()).toEqual(Object.keys(unicode).sort());
    const sameWidth: (keyof GlyphSet)[] = [
      'topLeft',
      'topRight',
      'bottomLeft',
      'bottomRight',
      'teeDown',
      'teeUp',
      'teeRight',
      'teeLeft',
      'cross',
      'rule',
      'ruleDots',
      'ornament',
      'quoteBar',
      'calloutBar',
      'focus',
      'foldOpen',
      'foldClosed',
      'script',
      'barFilled',
      'barEmpty',
      'starFilled',
      'starEmpty',
      'emptyValue',
    ];
    for (const key of sameWidth) {
      expect(measureWidth(ascii[key] as string), key).toBe(
        measureWidth(unicode[key] as string),
      );
    }
    for (const kind of ['solid', 'dashed'] as const) {
      expect(measureWidth(ascii[kind].horizontal)).toBe(1);
      expect(measureWidth(ascii[kind].vertical)).toBe(1);
    }
    expect([...ascii.sparkline]).toHaveLength([...unicode.sparkline].length);
  });

  it('an unknown style falls back to unicode', () => {
    expect(BOX_STYLES).toEqual(['unicode', 'ascii']);
    expect(glyphsFor(undefined)).toBe(glyphsFor('unicode'));
  });
});

describe("box: 'ascii' over the whole corpus", () => {
  for (const { name, source } of corpusInputs()) {
    for (const interactive of [false, true]) {
      it(`${name}${interactive ? ' (interactive shape)' : ''}: every byte is 7-bit`, async () => {
        const text = await renderMarkToAnsi(
          source,
          undefined,
          undefined,
          undefined,
          { width: 80, color: 'never', box: 'ascii', interactive },
        );
        expect(nonAscii(text)).toEqual([]);
      });
    }
  }
});

describe('the re-run legend', () => {
  it('is the plain legend with the r entry added, in both styles', () => {
    for (const style of ['unicode', 'ascii'] as const) {
      const set = glyphsFor(style);
      expect(set.keyLegendRerun).toBe(
        set.keyLegend.replace('q quit  ', 'q quit  r run  '),
      );
    }
  });
});
