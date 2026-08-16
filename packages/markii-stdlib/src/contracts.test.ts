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

  it('seeds exactly the three components that exist in @markii/react today', () => {
    expect(Object.keys(STANDARD_COMPONENTS).sort()).toEqual([
      'callout',
      'kbd',
      'rating',
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
