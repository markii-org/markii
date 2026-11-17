import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPONENT_PROPS } from './doc-css-component-props.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, 'doc.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every `--mk-*` name declared anywhere (left side of a colon). Tier 1 and Tier 2 live here. */
function declaredNames(): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/(--mk-[a-z0-9-]+)\s*:/g)) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

/** Every `var(--mk-x, fallback)` read, as name to the list of fallbacks written. */
function readsWithFallback(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const pattern = /var\(\s*(--mk-[a-z0-9-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g;
  for (const m of css.matchAll(pattern)) {
    const name = m[1];
    const fallback = m[2];
    if (!name || fallback === undefined) continue;
    out.set(name, [...(out.get(name) ?? []), fallback.trim()]);
  }
  return out;
}

describe('doc.css Tier 3 component properties', () => {
  const declared = declaredNames();
  const reads = readsWithFallback();

  it('the table equals every fallback read of a name doc.css never declares', () => {
    const undeclaredReads = [...reads.keys()].filter((n) => !declared.has(n));
    expect(new Set(COMPONENT_PROPS.map((p) => p.name))).toEqual(
      new Set(undeclaredReads),
    );
  });

  it('lists each name once', () => {
    const names = COMPONENT_PROPS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never declares a Tier 3 name', () => {
    for (const { name } of COMPONENT_PROPS) {
      expect(declared.has(name), name).toBe(false);
    }
  });

  it('every read of a Tier 3 name carries the documented default', () => {
    for (const { name, defaultValue } of COMPONENT_PROPS) {
      const fallbacks = reads.get(name) ?? [];
      expect(fallbacks.length, name).toBeGreaterThan(0);
      for (const fallback of fallbacks)
        expect(fallback, name).toBe(defaultValue);
    }
  });

  it('follows --mk-<component>-<part>-<css property> and holds no colors', () => {
    for (const { name, defaultValue } of COMPONENT_PROPS) {
      expect(name).toMatch(/^--mk-[a-z]+(-[a-z]+)*$/);
      expect(defaultValue).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    }
  });
});

/** WCAG 2.x relative luminance and contrast, on unrounded composited channels. */
function channel(raw: string, i: number): number {
  const hex =
    raw.length === 4
      ? `#${[1, 2, 3].map((k) => (raw[k] ?? '0').repeat(2)).join('')}`
      : raw;
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(rgb: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastAtOpacity(fg: string, bg: string, opacity: number): number {
  const rgb = [0, 1, 2].map(
    (i) => opacity * channel(fg, i) + (1 - opacity) * channel(bg, i),
  );
  const a = luminance(rgb);
  const b = luminance([0, 1, 2].map((i) => channel(bg, i)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The Tier 1 values of the block whose selector matches, read from the stripped stylesheet. */
function tokenValues(blockStart: RegExp): Record<string, string> {
  const start = css.search(blockStart);
  if (start < 0) throw new Error('block not found');
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--mk-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

describe('stale state contrast', () => {
  const opacity = Number(
    COMPONENT_PROPS.find((p) => p.name === '--mk-stale-opacity')?.defaultValue,
  );
  const light = tokenValues(/\.doc\s*\{\s*--mk-bg/);
  const dark = tokenValues(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*\.doc\s*\{/,
  );
  const palettes = { light, dark };

  // A stat sits on the page, inside a card (raised) or on a filled block
  // (surface), so the stale text must hold 4.5:1 over all three grounds.
  const grounds = ['--mk-bg', '--mk-raised', '--mk-surface'] as const;
  const parts = [
    ['label', '--mk-muted'],
    ['value', '--mk-fg'],
  ] as const;

  for (const [mode, palette] of Object.entries(palettes)) {
    for (const [part, token] of parts) {
      for (const ground of grounds) {
        it(`stat ${part} stays at 4.5:1 over ${mode} ${ground} at the default stale opacity`, () => {
          const fg = palette[token];
          const bg = palette[ground];
          if (!fg || !bg) throw new Error('palette incomplete');
          expect(contrastAtOpacity(fg, bg, opacity)).toBeGreaterThanOrEqual(
            4.5,
          );
        });
      }
    }
  }

  it('the default is the lowest 0.01 step that passes in both palettes on every ground', () => {
    const passes = (o: number): boolean =>
      Object.values(palettes).every((p) =>
        parts.every(([, t]) =>
          grounds.every(
            (g) => contrastAtOpacity(p[t] ?? '', p[g] ?? '', o) >= 4.5,
          ),
        ),
      );
    expect(passes(opacity)).toBe(true);
    expect(passes(Math.round((opacity - 0.01) * 100) / 100)).toBe(false);
  });
});
