import { describe, expect, it } from 'vitest';
import {
  resolveImageAttribute,
  resolveImageAttributes,
  srcsetCandidateUrls,
} from './image-resolve.js';
import { resolveHrefAttribute } from './href-resolve.js';
import { isSafeResolvedUrl } from './url-resolve.js';

/**
 * Executed probe for the dangerous-scheme refusal shared by
 * `resolveImageSrc` and `resolveHref` (`./url-resolve.js`). Runs the real
 * `resolveImageAttribute`/`resolveHrefAttribute` functions against classic
 * `javascript:`/`vbscript:` bypass payloads, not a description of them —
 * AGENTS.md requires an executed probe for security-relevant behavior, and
 * this suite is product code: it stays in the repo and stays green.
 *
 * Every payload below is a case a resolver, hostile or merely buggy, might
 * hand back; each must be refused (the original relative value kept)
 * exactly as if the resolver had returned `undefined`.
 */

const DANGEROUS_PAYLOADS: readonly { name: string; payload: string }[] = [
  { name: 'plain javascript:', payload: 'javascript:alert(1)' },
  { name: 'plain vbscript:', payload: 'vbscript:msgbox(1)' },
  {
    name: 'tab spliced into the scheme name',
    payload: 'java\tscript:alert(1)',
  },
  {
    name: 'newline spliced into the scheme name',
    payload: 'java\nscript:alert(1)',
  },
  {
    name: 'carriage return spliced into the scheme name',
    payload: 'java\rscript:alert(1)',
  },
  { name: 'leading space', payload: ' javascript:alert(1)' },
  { name: 'leading tab', payload: '\tjavascript:alert(1)' },
  {
    name: 'leading C0 control character',
    payload: 'javascript:alert(1)',
  },
  {
    name: 'leading whitespace plus a mid-scheme tab',
    payload: '  \tjava\tscript:alert(1)',
  },
  { name: 'mixed case', payload: 'JavaScript:alert(1)' },
  { name: 'mixed case with whitespace', payload: '  VbScript:msgbox(1)' },
];

/**
 * URL-encoding the scheme's colon is not a scheme delimiter at all — a
 * browser only treats a LITERAL `:` as the scheme separator, never a
 * percent-escape, so `javascript%3Aalert(1)` never becomes the `javascript:`
 * scheme in the first place. These are included to prove the check reads
 * them as ordinary (safe) relative-looking text, not as a bypass that
 * happens to slip through.
 */
const INERT_ENCODED_PAYLOADS: readonly string[] = [
  'javascript%3Aalert(1)',
  'JAVASCRIPT%3aalert(1)',
];

describe('resolveImageAttribute: dangerous-scheme refusal (executed probe)', () => {
  for (const { name, payload } of DANGEROUS_PAYLOADS) {
    it(`refuses a resolver returning: ${name}`, () => {
      const result = resolveImageAttribute('photo.png', () => payload);
      expect(result).toBe('photo.png');
    });
  }

  it('accepts a resolver returning a legitimate data: URI', () => {
    const result = resolveImageAttribute(
      'photo.png',
      () => 'data:image/png;base64,AA==',
    );
    expect(result).toBe('data:image/png;base64,AA==');
  });

  it('accepts a resolver returning a legitimate app: scheme (Obsidian-style)', () => {
    const result = resolveImageAttribute(
      'photo.png',
      () => 'app://vault/photo.png',
    );
    expect(result).toBe('app://vault/photo.png');
  });

  for (const payload of INERT_ENCODED_PAYLOADS) {
    it(`accepts an inert URL-encoded payload (never a real scheme): ${payload}`, () => {
      const result = resolveImageAttribute('photo.png', () => payload);
      expect(result).toBe(payload);
    });
  }
});

describe('resolveHrefAttribute: dangerous-scheme refusal (executed probe)', () => {
  for (const { name, payload } of DANGEROUS_PAYLOADS) {
    it(`refuses a resolver returning: ${name}`, () => {
      const result = resolveHrefAttribute('notes/a.md', () => payload);
      expect(result).toBe('notes/a.md');
    });
  }

  it('accepts a resolver returning a legitimate https: URL', () => {
    const result = resolveHrefAttribute(
      'notes/a.md',
      () => 'https://example.com/a',
    );
    expect(result).toBe('https://example.com/a');
  });
});

describe('isSafeResolvedUrl: the raw predicate behind both seams', () => {
  for (const { name, payload } of DANGEROUS_PAYLOADS) {
    it(`classifies "${name}" as unsafe`, () => {
      expect(isSafeResolvedUrl(payload)).toBe(false);
    });
  }

  for (const payload of INERT_ENCODED_PAYLOADS) {
    it(`classifies the inert encoded payload as safe: ${payload}`, () => {
      expect(isSafeResolvedUrl(payload)).toBe(true);
    });
  }

  it('classifies an ordinary relative path as safe', () => {
    expect(isSafeResolvedUrl('notes/a.md')).toBe(true);
  });
});

/**
 * Executed probe for the `srcset` an object-form `resolveImageSrc` result may
 * carry. Every candidate URL is held to the same scheme check as `src`. One
 * refused candidate drops the whole `srcset` and its `sizes`, keeps the
 * `src`, and sets `srcsetRefused` so the engine can mark the image.
 */
const HOSTILE_SRCSETS: readonly { name: string; srcset: string }[] = [
  { name: 'plain javascript:', srcset: 'javascript:alert(1) 1x' },
  { name: 'mixed case', srcset: 'a.png 1x, JaVaScRiPt:alert(1) 2x' },
  { name: 'vbscript:', srcset: 'vbscript:msgbox(1)' },
  { name: 'leading whitespace', srcset: '   \t javascript:alert(1) 1x' },
  { name: 'tab spliced into the scheme', srcset: 'java\tscript:alert(1) 1x' },
  { name: 'newline spliced into the scheme', srcset: 'java\nscript:alert(1)' },
  {
    name: 'no space after the comma',
    srcset: 'a.png 1x,javascript:alert(1) 2x',
  },
  {
    name: 'comma glued to the previous URL',
    srcset: 'a.png,javascript:alert(1)',
  },
  { name: 'leading commas', srcset: ',,,javascript:alert(1) 1x' },
  {
    name: 'after a data image URL',
    srcset: 'data:image/png;base64,AA== 1x, javascript:alert(1) 2x',
  },
  {
    name: 'descriptor with parentheses',
    srcset: 'a.png (1x, 2x), javascript:alert(1)',
  },
  {
    name: 'data:text/html',
    srcset: 'data:text/html,<script>alert(1)</script> 1x',
  },
  {
    name: 'data:text/html mixed case',
    srcset: 'DaTa:text/html;base64,AAAA 1x',
  },
  {
    name: 'data:text/html as the second candidate',
    srcset: 'a.png 1x, data:text/html,x 2x',
  },
];

const SAFE_SRCSETS: readonly { name: string; srcset: string }[] = [
  {
    name: 'two https candidates',
    srcset: 'https://a.test/a.png 1x, https://a.test/b.png 2x',
  },
  {
    name: 'a data image URL with a comma',
    srcset: 'data:image/png;base64,AA== 1x',
  },
  { name: 'relative candidates with widths', srcset: 'a.png 320w, b.png 640w' },
  { name: 'an inert encoded scheme', srcset: 'javascript%3Aalert(1) 1x' },
];

describe('resolveImageAttributes: srcset refusal (executed probe)', () => {
  for (const { name, srcset } of HOSTILE_SRCSETS) {
    it(`drops the srcset and keeps the src: ${name}`, () => {
      const result = resolveImageAttributes('photo.png', () => ({
        src: 'https://cdn.test/p.png',
        srcset,
        sizes: '100vw',
      }));
      expect(result.src).toBe('https://cdn.test/p.png');
      expect(result.srcset).toBeUndefined();
      expect(result.sizes).toBeUndefined();
      expect(result.srcsetRefused).toBe(true);
    });
  }

  for (const { name, srcset } of SAFE_SRCSETS) {
    it(`keeps a safe srcset: ${name}`, () => {
      const result = resolveImageAttributes('photo.png', () => ({
        src: 'https://cdn.test/p.png',
        srcset,
        sizes: '100vw',
      }));
      expect(result.srcset).toBe(srcset);
      expect(result.sizes).toBe('100vw');
      expect(result.srcsetRefused).toBe(false);
    });
  }

  it('ignores the whole answer when its src is dangerous', () => {
    const result = resolveImageAttributes('photo.png', () => ({
      src: 'javascript:alert(1)',
      srcset: 'a.png 1x',
      width: 10,
    }));
    expect(result.src).toBe('photo.png');
    expect(result.srcset).toBeUndefined();
    expect(result.width).toBeUndefined();
  });

  it('refuses a non-image data: src from a resolver as well', () => {
    expect(
      resolveImageAttribute('photo.png', () => 'data:text/html,<b>x</b>'),
    ).toBe('photo.png');
  });

  it('splits candidates the way the HTML parser does', () => {
    expect(
      srcsetCandidateUrls(
        'data:image/png;base64,AA== 1x, b.png (a,b) 2x,c.png,',
      ),
    ).toEqual(['data:image/png;base64,AA==', 'b.png', 'c.png']);
  });
});
