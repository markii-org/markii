import { describe, expect, it } from 'vitest';
import {
  componentSourceForEngine,
  isPackAttributeName,
  packComponents,
  packComponentsForEngine,
  packSupportsEngine,
  resolvePackComponent,
} from './components.js';
import type { ResolvedPackComponent } from './components.js';
import type { PackManifest } from './manifest.js';

// Most cases below are about metadata, not engines: flatten the react
// source back to a plain `source` so those assertions stay readable.
function flat(
  r: ResolvedPackComponent,
): Omit<ResolvedPackComponent, 'sources'> & { source?: string } {
  const { sources, ...rest } = r;
  const source = sources['react'];
  return source === undefined ? rest : { source, ...rest };
}
function resolveReact(entry: unknown) {
  const r = resolvePackComponent(entry, 'react');
  return r === undefined ? undefined : flat(r);
}
function listReact(manifest: Pick<PackManifest, 'components'>) {
  return packComponents({ ...manifest, engine: 'react' }).map((l) => {
    const { localName, ...rest } = l;
    return { localName, ...flat(rest) };
  });
}

describe('resolvePackComponent', () => {
  it('resolves the string shorthand', () => {
    expect(resolveReact('./Timeline.tsx')).toEqual({
      source: './Timeline.tsx',
    });
  });

  it('rejects an empty string', () => {
    expect(resolveReact('')).toBeUndefined();
  });

  it('resolves the object form with all fields', () => {
    expect(
      resolveReact({
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
    expect(resolveReact({ source: './profile.tsx' })).toEqual({
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
      expect(() => resolveReact(input)).not.toThrow();
      expect(resolveReact(input)).toBeUndefined();
    }
  });

  it('drops an invalid kind rather than throwing or fabricating one', () => {
    expect(resolveReact({ source: './x.tsx', kind: 'widget' })).toEqual({
      source: './x.tsx',
    });
  });

  it('drops a non-string description rather than throwing', () => {
    expect(resolveReact({ source: './x.tsx', description: 42 })).toEqual({
      source: './x.tsx',
    });
  });

  it('does not read source through the prototype chain', () => {
    const evilProto = { source: './injected.tsx' };
    const entry = Object.create(evilProto) as Record<string, unknown>;
    expect(resolveReact(entry)).toBeUndefined();
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
    expect(listReact(manifest)).toEqual([
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
    expect(listReact({} as Pick<PackManifest, 'components'>)).toEqual([]);
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
        listReact(manifest as Pick<PackManifest, 'components'>),
      ).not.toThrow();
      expect(listReact(manifest as Pick<PackManifest, 'components'>)).toEqual(
        [],
      );
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
    expect(listReact(manifest)).toEqual([
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
    expect(listReact(manifest)).toEqual([
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
    expect(listReact(manifest)).toEqual([
      { localName: 'real', source: './Real.tsx' },
    ]);
  });
});

describe('resolvePackComponent: declared attributes', () => {
  it('normalizes a declared attribute list', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [
          { name: 'name', description: 'The name.', required: true },
          { name: 'mood', values: ['happy', 'grumpy'], default: 'grumpy' },
        ],
      }),
    ).toEqual({
      source: './x.tsx',
      attributes: [
        { name: 'name', description: 'The name.', required: true },
        { name: 'mood', values: ['happy', 'grumpy'], default: 'grumpy' },
      ],
    });
  });

  it('omits attributes entirely when the list is missing, empty, or not an array', () => {
    for (const attributes of [undefined, [], 'mood', {}, null]) {
      const resolved = resolveReact({ source: './x.tsx', attributes });
      expect(resolved).toEqual({ source: './x.tsx' });
    }
  });

  it('drops a malformed entry instead of throwing', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [
          'mood',
          { name: 'Mood' },
          { description: 'no name' },
          null,
          { name: 'ok' },
        ],
      }),
    ).toEqual({ source: './x.tsx', attributes: [{ name: 'ok' }] });
  });

  it('keeps the first of a duplicated attribute name', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [
          { name: 'mood', description: 'first' },
          { name: 'mood', description: 'second' },
        ],
      }),
    ).toEqual({
      source: './x.tsx',
      attributes: [{ name: 'mood', description: 'first' }],
    });
  });

  it('drops a default that is not one of the declared values', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [{ name: 'mood', values: ['happy'], default: 'grumpy' }],
      }),
    ).toEqual({
      source: './x.tsx',
      attributes: [{ name: 'mood', values: ['happy'] }],
    });
  });

  it('drops non-string members of values and the field when none survive', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [{ name: 'mood', values: ['happy', 3, ''] }],
      }),
    ).toEqual({
      source: './x.tsx',
      attributes: [{ name: 'mood', values: ['happy'] }],
    });
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [{ name: 'mood', values: [3, ''] }],
      }),
    ).toEqual({ source: './x.tsx', attributes: [{ name: 'mood' }] });
  });

  it('reads attribute fields only as own properties', () => {
    const hostile = Object.create({ name: 'inherited' }) as object;
    expect(resolveReact({ source: './x.tsx', attributes: [hostile] })).toEqual({
      source: './x.tsx',
    });
  });

  it('ignores a non-true required rather than rejecting the attribute', () => {
    expect(
      resolveReact({
        source: './x.tsx',
        attributes: [{ name: 'mood', required: 'yes' }],
      }),
    ).toEqual({ source: './x.tsx', attributes: [{ name: 'mood' }] });
  });
});

describe('isPackAttributeName', () => {
  it('accepts lowercase names with digits and hyphens', () => {
    for (const name of ['a', 'mood', 'mood2', 'refresh-every', 'a-b-c']) {
      expect(isPackAttributeName(name)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const name of [
      '',
      'Mood',
      '1mood',
      '-mood',
      'my_attr',
      'a:b',
      42,
      null,
      undefined,
    ]) {
      expect(isPackAttributeName(name)).toBe(false);
    }
  });
});

describe('sources (per-engine implementations)', () => {
  const manifest: Pick<PackManifest, 'components' | 'engine'> = {
    engine: 'react',
    components: {
      both: { sources: { react: './b.react.tsx', ansi: './b.ansi.tsx' } },
      only: './o.tsx',
      term: { sources: { ansi: './t.ansi.tsx' } },
    },
  };

  it('normalizes every form into a sources map', () => {
    const listings = packComponents(manifest);
    expect(listings.map((l) => ({ ...l.sources }))).toEqual([
      { react: './b.react.tsx', ansi: './b.ansi.tsx' },
      { react: './o.tsx' },
      { ansi: './t.ansi.tsx' },
    ]);
  });

  it('answers the source for an engine, or none', () => {
    const [both, , term] = packComponents(manifest);
    expect(componentSourceForEngine(both!, 'ansi')).toBe('./b.ansi.tsx');
    expect(componentSourceForEngine(term!, 'react')).toBeUndefined();
    expect(componentSourceForEngine(term!, 'constructor')).toBeUndefined();
  });

  it('filters listings per engine', () => {
    expect(
      packComponentsForEngine(manifest, 'react').map((l) => [
        l.localName,
        l.source,
      ]),
    ).toEqual([
      ['both', './b.react.tsx'],
      ['only', './o.tsx'],
    ]);
    expect(
      packComponentsForEngine(manifest, 'ansi').map((l) => l.localName),
    ).toEqual(['both', 'term']);
    expect(packComponentsForEngine(manifest, 'future')).toEqual([]);
  });

  it('supports an engine when any component has a source or there are none', () => {
    expect(packSupportsEngine(manifest, 'ansi')).toBe(true);
    expect(packSupportsEngine(manifest, 'future')).toBe(false);
    expect(
      packSupportsEngine({ engine: 'react', components: {} }, 'ansi'),
    ).toBe(true);
  });

  it('rejects an entry carrying both source and sources', () => {
    expect(
      resolvePackComponent(
        { source: './a.tsx', sources: { ansi: './a.ansi.tsx' } },
        'react',
      ),
    ).toBeUndefined();
  });

  it('drops malformed engine ids and paths', () => {
    const r = resolvePackComponent(
      { sources: { Bad: './x', ansi: '', ok: './ok.tsx' } },
      'react',
    );
    expect({ ...r?.sources }).toEqual({ ok: './ok.tsx' });
  });
});
