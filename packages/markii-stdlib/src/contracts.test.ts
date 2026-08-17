import { describe, expect, it } from 'vitest';
import {
  getContract,
  STANDARD_COMPONENTS,
  type ComponentContract,
  type ComponentKind,
} from './contracts';

const KINDS: readonly ComponentKind[] = ['inline', 'leaf', 'container'];

function isWellFormed(contract: ComponentContract): boolean {
  if (typeof contract.name !== 'string' || contract.name.length === 0) {
    return false;
  }
  if (!KINDS.includes(contract.kind)) return false;
  if (
    typeof contract.description !== 'string' ||
    contract.description.length === 0
  ) {
    return false;
  }
  for (const schema of Object.values(contract.attributes)) {
    if (schema.type !== 'string') return false;
    if (
      typeof schema.description !== 'string' ||
      schema.description.length === 0
    ) {
      return false;
    }
    if (schema.enum && schema.enum.length === 0) return false;
  }
  return true;
}

describe('STANDARD_COMPONENTS', () => {
  it('is structurally well-formed for every entry', () => {
    for (const [key, contract] of Object.entries(STANDARD_COMPONENTS)) {
      expect(contract.name).toBe(key);
      expect(isWellFormed(contract)).toBe(true);
    }
  });

  it('keys every entry by its own name', () => {
    for (const [key, contract] of Object.entries(STANDARD_COMPONENTS)) {
      expect(contract.name).toBe(key);
    }
  });

  it('seeds exactly the thirteen components that exist in @markii/react today', () => {
    expect(Object.keys(STANDARD_COMPONENTS).sort()).toEqual([
      'badge',
      'callout',
      'card',
      'chart',
      'details',
      'figure',
      'kbd',
      'progress',
      'rating',
      'row',
      'stat',
      'tab',
      'tabs',
    ]);
  });

  it('marks callout as a container directive, matching its :::callout{...} ... ::: form', () => {
    expect(STANDARD_COMPONENTS.callout?.kind).toBe('container');
  });

  it('marks kbd as an inline directive, matching its :kbd[...] form', () => {
    expect(STANDARD_COMPONENTS.kbd?.kind).toBe('inline');
  });

  it('marks rating as a leaf directive, matching its ::rating{...} form', () => {
    expect(STANDARD_COMPONENTS.rating?.kind).toBe('leaf');
  });

  it("callout's type attribute is a closed enum of exactly the variants the component recognizes", () => {
    expect(STANDARD_COMPONENTS.callout?.attributes.type?.enum).toEqual([
      'info',
      'warning',
      'danger',
    ]);
  });

  it('kbd takes no attributes', () => {
    expect(STANDARD_COMPONENTS.kbd?.attributes).toEqual({});
  });

  it("rating's attributes are exactly value and max, both optional", () => {
    const attrs = STANDARD_COMPONENTS.rating?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual(['max', 'value']);
    expect(attrs.value?.required).toBeFalsy();
    expect(attrs.max?.required).toBeFalsy();
  });

  it('marks details, card, figure, tabs, and tab as container directives', () => {
    expect(STANDARD_COMPONENTS.details?.kind).toBe('container');
    expect(STANDARD_COMPONENTS.card?.kind).toBe('container');
    expect(STANDARD_COMPONENTS.figure?.kind).toBe('container');
    expect(STANDARD_COMPONENTS.tabs?.kind).toBe('container');
    expect(STANDARD_COMPONENTS.tab?.kind).toBe('container');
  });

  it('marks badge as an inline directive, matching its :badge[...] form', () => {
    expect(STANDARD_COMPONENTS.badge?.kind).toBe('inline');
  });

  it("badge's variant attribute is a closed enum including neutral as a value", () => {
    expect(STANDARD_COMPONENTS.badge?.attributes.variant?.enum).toEqual([
      'neutral',
      'info',
      'success',
      'warning',
      'danger',
    ]);
  });

  it("figure's src attribute is required and alt is optional", () => {
    const attrs = STANDARD_COMPONENTS.figure?.attributes ?? {};
    expect(attrs.src?.required).toBe(true);
    expect(attrs.alt?.required).toBeFalsy();
  });

  it("details's title and open attributes are both optional", () => {
    const attrs = STANDARD_COMPONENTS.details?.attributes ?? {};
    expect(attrs.title?.required).toBeFalsy();
    expect(attrs.open?.required).toBeFalsy();
  });

  it('tabs takes no attributes of its own', () => {
    expect(STANDARD_COMPONENTS.tabs?.attributes).toEqual({});
  });

  it("tab's label attribute is optional", () => {
    expect(STANDARD_COMPONENTS.tab?.attributes.label?.required).toBeFalsy();
  });

  it('marks stat, progress, and chart as leaf directives (the data-bound dashboard set)', () => {
    expect(STANDARD_COMPONENTS.stat?.kind).toBe('leaf');
    expect(STANDARD_COMPONENTS.progress?.kind).toBe('leaf');
    expect(STANDARD_COMPONENTS.chart?.kind).toBe('leaf');
  });

  it("stat's attributes are exactly value, label, delta, and trend, all optional", () => {
    const attrs = STANDARD_COMPONENTS.stat?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual([
      'delta',
      'label',
      'trend',
      'value',
    ]);
    for (const schema of Object.values(attrs)) {
      expect(schema.required).toBeFalsy();
    }
  });

  it("stat's trend attribute is a closed enum of up/down/flat", () => {
    expect(STANDARD_COMPONENTS.stat?.attributes.trend?.enum).toEqual([
      'up',
      'down',
      'flat',
    ]);
  });

  it("progress's attributes are exactly value, max, and label, all optional", () => {
    const attrs = STANDARD_COMPONENTS.progress?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual(['label', 'max', 'value']);
    for (const schema of Object.values(attrs)) {
      expect(schema.required).toBeFalsy();
    }
  });

  it("chart's attributes are exactly kind, values, height, and width, all optional", () => {
    const attrs = STANDARD_COMPONENTS.chart?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual([
      'height',
      'kind',
      'values',
      'width',
    ]);
    for (const schema of Object.values(attrs)) {
      expect(schema.required).toBeFalsy();
    }
  });

  it("chart's kind attribute is a closed enum of line/bar", () => {
    expect(STANDARD_COMPONENTS.chart?.attributes.kind?.enum).toEqual([
      'line',
      'bar',
    ]);
  });

  it('marks row as a container directive, matching its :::row{...} ... ::: form', () => {
    expect(STANDARD_COMPONENTS.row?.kind).toBe('container');
  });

  it("row's only attribute is cols, optional, a closed enum of 2/3/4", () => {
    const attrs = STANDARD_COMPONENTS.row?.attributes ?? {};
    expect(Object.keys(attrs)).toEqual(['cols']);
    expect(attrs.cols?.required).toBeFalsy();
    expect(attrs.cols?.enum).toEqual(['2', '3', '4']);
  });
});

describe('getContract', () => {
  it('returns the matching contract for a standard name', () => {
    expect(getContract('callout')?.kind).toBe('container');
    expect(getContract('kbd')?.kind).toBe('inline');
    expect(getContract('rating')?.kind).toBe('leaf');
  });

  it('returns undefined for a name that is not a standard component', () => {
    expect(getContract('does-not-exist')).toBeUndefined();
  });

  it('is prototype-safe against __proto__', () => {
    expect(getContract('__proto__')).toBeUndefined();
  });

  it('is prototype-safe against constructor', () => {
    expect(getContract('constructor')).toBeUndefined();
  });

  it('is prototype-safe against other inherited Object.prototype members', () => {
    expect(getContract('toString')).toBeUndefined();
    expect(getContract('hasOwnProperty')).toBeUndefined();
    expect(getContract('valueOf')).toBeUndefined();
  });
});
