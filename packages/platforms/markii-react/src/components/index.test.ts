import { describe, expect, it } from 'vitest';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import { defaultRegistry } from './index';

describe('defaultRegistry — inline flag derived from @markii/stdlib contracts', () => {
  // Locks in today's known-good values (`inline: false` for callout/rating,
  // `inline: true` for kbd) so a `defaultRegistry` that now *computes*
  // `inline` from `@markii/stdlib`'s `ComponentKind` is proven to produce
  // the exact same registry behavior as the previous hardcoded literals —
  // this is a source-of-truth shift, not a behavior change.
  it('matches the prior hardcoded inline values exactly', () => {
    expect(defaultRegistry.callout?.inline).toBe(false);
    expect(defaultRegistry.kbd?.inline).toBe(true);
    expect(defaultRegistry.rating?.inline).toBe(false);
  });
});

describe('defaultRegistry — conformance to the @markii/stdlib standard set', () => {
  it('registers every name in STANDARD_COMPONENTS', () => {
    for (const name of Object.keys(STANDARD_COMPONENTS)) {
      expect(defaultRegistry[name]).toBeDefined();
    }
  });

  it("agrees with each standard contract's kind (inline <-> inline, leaf/container <-> block)", () => {
    for (const contract of Object.values(STANDARD_COMPONENTS)) {
      const entry = defaultRegistry[contract.name];
      expect(entry).toBeDefined();
      const expectedInline = contract.kind === 'inline';
      expect(entry?.inline).toBe(expectedInline);
    }
  });
});
