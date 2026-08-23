import { describe, expect, it } from 'vitest';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import { defaultHtmlRegistry } from './index.js';

describe('defaultHtmlRegistry — inline flag derived from @markii/stdlib contracts', () => {
  it('matches the known-good values (inline: false for callout/rating, inline: true for kbd)', () => {
    expect(defaultHtmlRegistry.callout?.inline).toBe(false);
    expect(defaultHtmlRegistry.kbd?.inline).toBe(true);
    expect(defaultHtmlRegistry.rating?.inline).toBe(false);
  });
});

describe('defaultHtmlRegistry — conformance to the @markii/stdlib standard set', () => {
  it('registers every name in STANDARD_COMPONENTS, including the data-bound trio', () => {
    for (const name of Object.keys(STANDARD_COMPONENTS)) {
      expect(defaultHtmlRegistry[name]).toBeDefined();
    }
  });

  it('registers stat/progress/chart as block (leaf) components', () => {
    expect(defaultHtmlRegistry.stat?.inline).toBe(false);
    expect(defaultHtmlRegistry.progress?.inline).toBe(false);
    expect(defaultHtmlRegistry.chart?.inline).toBe(false);
  });

  it("agrees with each registered standard contract's kind (inline <-> inline, leaf/container <-> block)", () => {
    for (const contract of Object.values(STANDARD_COMPONENTS)) {
      const entry = defaultHtmlRegistry[contract.name];
      expect(entry).toBeDefined();
      const expectedInline = contract.kind === 'inline';
      expect(entry?.inline).toBe(expectedInline);
    }
  });
});
