import { describe, expect, it } from 'vitest';
import { isValidPackNameShape, resolveUses } from './uses.js';

describe('resolveUses', () => {
  it('reports not-declared when declaredUses is undefined', () => {
    expect(resolveUses(undefined, ['ana', 'gh'])).toEqual({
      declared: false,
      missing: [],
      satisfied: [],
    });
  });

  it('does not inspect installedNamespaces when not declared', () => {
    // A generator that would throw if iterated proves resolveUses returns
    // early without ever touching it.
    function* poison(): Generator<string> {
      throw new Error('should not be iterated');
    }
    expect(resolveUses(undefined, poison())).toEqual({
      declared: false,
      missing: [],
      satisfied: [],
    });
  });

  it('reports declared-empty for uses: []', () => {
    expect(resolveUses([], ['ana'])).toEqual({
      declared: true,
      missing: [],
      satisfied: [],
    });
  });

  it('reports all satisfied when every declared pack is installed', () => {
    expect(resolveUses(['ana', 'gh'], ['ana', 'gh', 'bea'])).toEqual({
      declared: true,
      missing: [],
      satisfied: ['ana', 'gh'],
    });
  });

  it('reports some missing when only some declared packs are installed', () => {
    expect(resolveUses(['ana', 'gh', 'bea'], ['gh'])).toEqual({
      declared: true,
      missing: ['ana', 'bea'],
      satisfied: ['gh'],
    });
  });

  it('reports all missing when nothing is installed', () => {
    expect(resolveUses(['ana', 'gh'], [])).toEqual({
      declared: true,
      missing: ['ana', 'gh'],
      satisfied: [],
    });
  });

  it('de-duplicates the declared list, keeping first-seen order', () => {
    expect(resolveUses(['ana', 'gh', 'ana', 'gh', 'bea'], ['gh'])).toEqual({
      declared: true,
      missing: ['ana', 'bea'],
      satisfied: ['gh'],
    });
  });

  it('preserves declared order across missing and satisfied separately', () => {
    const result = resolveUses(['bea', 'ana', 'cee', 'gh'], ['ana', 'gh']);
    expect(result.missing).toEqual(['bea', 'cee']);
    expect(result.satisfied).toEqual(['ana', 'gh']);
  });

  it('does not mutate the declaredUses input', () => {
    const declared = ['ana', 'gh'];
    const frozen = Object.freeze([...declared]);
    resolveUses(frozen, ['ana']);
    expect(frozen).toEqual(['ana', 'gh']);
  });

  it('accepts any iterable for installedNamespaces, not just arrays', () => {
    const installedSet = new Set(['ana']);
    expect(resolveUses(['ana', 'gh'], installedSet)).toEqual({
      declared: true,
      missing: ['gh'],
      satisfied: ['ana'],
    });

    function* installedGen(): Generator<string> {
      yield 'gh';
    }
    expect(resolveUses(['ana', 'gh'], installedGen())).toEqual({
      declared: true,
      missing: ['ana'],
      satisfied: ['gh'],
    });
  });

  it('handles a prototype-shaped installed set without breaking the lookup', () => {
    const installed = ['__proto__', 'constructor', 'hasOwnProperty', 'ana'];
    const result = resolveUses(
      ['__proto__', 'constructor', 'ana', 'gh'],
      installed,
    );
    expect(result).toEqual({
      declared: true,
      missing: ['gh'],
      satisfied: ['__proto__', 'constructor', 'ana'],
    });
  });

  it('handles a prototype-shaped declared name against an empty installed set', () => {
    const result = resolveUses(['__proto__', 'toString'], []);
    expect(result).toEqual({
      declared: true,
      missing: ['__proto__', 'toString'],
      satisfied: [],
    });
  });
});

describe('isValidPackNameShape', () => {
  it('accepts a valid lowercase-kebab name', () => {
    expect(isValidPackNameShape('ana')).toBe(true);
  });

  it('rejects a name that could never be a pack namespace', () => {
    expect(isValidPackNameShape('__proto__')).toBe(false);
    expect(isValidPackNameShape('Ana Charts')).toBe(false);
    expect(isValidPackNameShape('scripts')).toBe(false);
  });
});
