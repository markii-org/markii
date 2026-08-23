import { describe, expect, it } from 'vitest';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import { defaultHtmlRegistry } from './index.js';

/** Data-bound standard components deferred to a later slice (need ctx.resolve). */
const DEFERRED = new Set(['stat', 'progress', 'chart']);

describe('defaultHtmlRegistry — inline flag derived from @markii/stdlib contracts', () => {
  it('matches the known-good values (inline: false for callout/rating, inline: true for kbd)', () => {
    expect(defaultHtmlRegistry.callout?.inline).toBe(false);
    expect(defaultHtmlRegistry.kbd?.inline).toBe(true);
    expect(defaultHtmlRegistry.rating?.inline).toBe(false);
  });
});

describe('defaultHtmlRegistry — conformance to the @markii/stdlib standard set (presentational subset)', () => {
  it('registers every non-deferred name in STANDARD_COMPONENTS', () => {
    for (const name of Object.keys(STANDARD_COMPONENTS)) {
      if (DEFERRED.has(name)) continue;
      expect(defaultHtmlRegistry[name]).toBeDefined();
    }
  });

  it('does NOT register the deferred data-bound components', () => {
    for (const name of DEFERRED) {
      expect(defaultHtmlRegistry[name]).toBeUndefined();
    }
  });

  it("agrees with each registered standard contract's kind (inline <-> inline, leaf/container <-> block)", () => {
    for (const contract of Object.values(STANDARD_COMPONENTS)) {
      if (DEFERRED.has(contract.name)) continue;
      const entry = defaultHtmlRegistry[contract.name];
      expect(entry).toBeDefined();
      const expectedInline = contract.kind === 'inline';
      expect(entry?.inline).toBe(expectedInline);
    }
  });
});
