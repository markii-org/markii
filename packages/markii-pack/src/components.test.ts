import { describe, expect, it } from 'vitest';
import { packComponents, resolvePackComponent } from './components.js';
import type { PackManifest } from './manifest.js';

describe('resolvePackComponent', () => {
  it('resolves the string shorthand', () => {
    expect(resolvePackComponent('./Timeline.tsx')).toEqual({
      source: './Timeline.tsx',
    });
  });

  it('rejects an empty string', () => {
    expect(resolvePackComponent('')).toBeUndefined();
  });

  it('resolves the object form with all fields', () => {
    expect(
      resolvePackComponent({
        source: './profile.tsx',
        description: 'A cat profile card.',
        kind: 'container',
      }),
    ).toEqual({
      source: './profile.tsx',
      description: 'A cat profile card.',
      kind: 'container',
    });
  });

  it('resolves the object form with only source', () => {
    expect(resolvePackComponent({ source: './profile.tsx' })).toEqual({
      source: './profile.tsx',
    });
  });

  it('never throws on hostile input and returns undefined', () => {
    const hostileInputs: unknown[] = [
      null,
      undefined,
      42,
      true,
      [],
      ['./x.tsx'],
      {},
      { description: 'no source' },
      { source: 42 },
      { source: '' },
      { source: null },
      Object.create({ source: './injected.tsx' }),
      new Map([['source', './x.tsx']]),
    ];
    for (const input of hostileInputs) {
      expect(() => resolvePackComponent(input)).not.toThrow();
      expect(resolvePackComponent(input)).toBeUndefined();
    }
  });

  it('drops an invalid kind rather than throwing or fabricating one', () => {
    expect(resolvePackComponent({ source: './x.tsx', kind: 'widget' })).toEqual(
      { source: './x.tsx' },
    );
  });

  it('drops a non-string description rather than throwing', () => {
    expect(
      resolvePackComponent({ source: './x.tsx', description: 42 }),
    ).toEqual({ source: './x.tsx' });
  });

  it('does not read source through the prototype chain', () => {
    const evilProto = { source: './injected.tsx' };
    const entry = Object.create(evilProto) as Record<string, unknown>;
    expect(resolvePackComponent(entry)).toBeUndefined();
  });
});

describe('packComponents', () => {
  it('lists both string and object entries in declaration order', () => {
    const manifest: Pick<PackManifest, 'components'> = {
      components: {
        b: './B.tsx',
        a: { source: './A.tsx', kind: 'leaf', description: 'A component.' },
      },
    };
    expect(packComponents(manifest)).toEqual([
      { localName: 'b', source: './B.tsx' },
      {
        localName: 'a',
        source: './A.tsx',
        kind: 'leaf',
        description: 'A component.',
      },
    ]);
  });

  it('returns [] for a missing components field', () => {
    expect(packComponents({} as Pick<PackManifest, 'components'>)).toEqual([]);
  });

  it('returns [] rather than throwing when components is not a plain object', () => {
    const hostileManifests: unknown[] = [
      { components: null },
      { components: 'nope' },
      { components: 42 },
      { components: [] },
      { components: ['./x.tsx'] },
    ];
    for (const manifest of hostileManifests) {
      expect(() =>
        packComponents(manifest as Pick<PackManifest, 'components'>),
      ).not.toThrow();
      expect(
        packComponents(manifest as Pick<PackManifest, 'components'>),
      ).toEqual([]);
    }
  });

  it('skips unresolvable entries without throwing', () => {
    const manifest = {
      components: {
        good: './Good.tsx',
        bad: { description: 'no source' },
        empty: '',
      },
    } as unknown as Pick<PackManifest, 'components'>;
    expect(packComponents(manifest)).toEqual([
      { localName: 'good', source: './Good.tsx' },
    ]);
  });

  it('does not walk the prototype chain of a null-prototype components map', () => {
    const components = Object.create(null) as Record<string, unknown>;
    components.a = './A.tsx';
    const manifest = { components } as unknown as Pick<
      PackManifest,
      'components'
    >;
    expect(packComponents(manifest)).toEqual([
      { localName: 'a', source: './A.tsx' },
    ]);
  });

  it('ignores inherited-only entries on the components map', () => {
    const evilProto = { injected: './Injected.tsx' };
    const components = Object.create(evilProto) as Record<string, unknown>;
    components.real = './Real.tsx';
    const manifest = { components } as unknown as Pick<
      PackManifest,
      'components'
    >;
    expect(packComponents(manifest)).toEqual([
      { localName: 'real', source: './Real.tsx' },
    ]);
  });
});
