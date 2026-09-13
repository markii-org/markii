import { describe, expect, it } from 'vitest';
import { resolveImageAttribute } from './image-resolve.js';
import { resolveHrefAttribute } from './href-resolve.js';
import { isSafeResolvedUrl } from './url-resolve.js';

/**
 * Executed probe for the dangerous-scheme refusal shared by
 * `resolveImageSrc` and `resolveHref` (`./url-resolve.js`), ported from
 * `@markii/html`'s `url-resolve.probe.test.ts` (itself mirroring
 * `@markii/react`'s). AGENTS.md requires an executed probe for
 * security-relevant behavior; this suite is product code and stays green.
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
    payload: '\x01javascript:alert(1)',
  },
  {
    name: 'leading whitespace plus a mid-scheme tab',
    payload: '  \tjava\tscript:alert(1)',
  },
  { name: 'mixed case', payload: 'JavaScript:alert(1)' },
  { name: 'mixed case with whitespace', payload: '  VbScript:msgbox(1)' },
];

const INERT_ENCODED_PAYLOADS: readonly string[] = [
  'javascript%3Aalert(1)',
  'JAVASCRIPT%3aalert(1)',
];

describe('resolveImageAttribute: dangerous-scheme refusal (executed probe)', () => {
  for (const { name, payload } of DANGEROUS_PAYLOADS) {
    it(`refuses a resolver returning: ${name}`, () => {
      expect(resolveImageAttribute('photo.png', () => payload)).toBe(
        'photo.png',
      );
    });
  }

  it('accepts a resolver returning a legitimate data: URI', () => {
    expect(
      resolveImageAttribute('photo.png', () => 'data:image/png;base64,AA=='),
    ).toBe('data:image/png;base64,AA==');
  });

  it('accepts a resolver returning a legitimate app: scheme (Obsidian-style)', () => {
    expect(
      resolveImageAttribute('photo.png', () => 'app://vault/photo.png'),
    ).toBe('app://vault/photo.png');
  });

  for (const payload of INERT_ENCODED_PAYLOADS) {
    it(`accepts an inert URL-encoded payload (never a real scheme): ${payload}`, () => {
      expect(resolveImageAttribute('photo.png', () => payload)).toBe(payload);
    });
  }
});

describe('resolveHrefAttribute: dangerous-scheme refusal (executed probe)', () => {
  for (const { name, payload } of DANGEROUS_PAYLOADS) {
    it(`refuses a resolver returning: ${name}`, () => {
      expect(resolveHrefAttribute('notes/a.md', () => payload)).toBe(
        'notes/a.md',
      );
    });
  }

  it('accepts a resolver returning a legitimate https: URL', () => {
    expect(
      resolveHrefAttribute('notes/a.md', () => 'https://example.com/a'),
    ).toBe('https://example.com/a');
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
