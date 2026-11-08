import { describe, expect, it } from 'vitest';
import { createUnavailableComponentLookup } from './diagnostics.js';

describe('createUnavailableComponentLookup', () => {
  it('is undefined for an omitted or empty list, so a render takes its old path', () => {
    expect(createUnavailableComponentLookup(undefined)).toBeUndefined();
    expect(createUnavailableComponentLookup([])).toBeUndefined();
  });

  it('finds a listed directive and nothing else', () => {
    const lookup = createUnavailableComponentLookup([
      { directive: 'ana_meter', pack: 'ana', engines: ['react'] },
    ]);
    expect(lookup?.('ana_meter')).toEqual({
      directive: 'ana_meter',
      pack: 'ana',
      engines: ['react'],
    });
    expect(lookup?.('ana_typo')).toBeUndefined();
  });

  it('never resolves a prototype member name', () => {
    const lookup = createUnavailableComponentLookup([
      { directive: 'a_b', pack: 'a', engines: [] },
    ]);
    for (const name of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(lookup?.(name)).toBeUndefined();
    }
  });

  it('skips malformed entries and keeps the first of a repeated name', () => {
    const lookup = createUnavailableComponentLookup([
      null,
      { directive: 1, pack: 'a', engines: [] },
      { directive: 'a_b', pack: 'a', engines: 'react' },
      { directive: 'a_c', pack: 'first', engines: ['react', 3] },
      { directive: 'a_c', pack: 'second', engines: [] },
    ] as never);
    expect(lookup?.('a_b')).toBeUndefined();
    expect(lookup?.('a_c')).toEqual({
      directive: 'a_c',
      pack: 'first',
      engines: ['react'],
    });
  });
});
