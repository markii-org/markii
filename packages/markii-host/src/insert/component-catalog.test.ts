import { describe, expect, it } from 'vitest';
import {
  ALIGN_PRESETS,
  STANDARD_COMPONENTS,
  WIDTH_PRESETS,
} from '@markii/stdlib';
import type { PackComponentEntry } from '@markii/pack';
import {
  LAYOUT_WRAPPER_NAMES,
  buildComponentCatalog,
} from './component-catalog.js';
import type { DiscoveredPack } from '../packs/discover.js';

function pack(
  name: string,
  components: Record<string, PackComponentEntry>,
  folder = `/packs/${name}`,
): DiscoveredPack {
  return {
    folder,
    manifest: { name, engine: 'react', components },
    componentPaths: Object.fromEntries(
      Object.entries(components).map(([local, entry]) => [
        local,
        `${folder}/${typeof entry === 'string' ? entry : entry.source}`,
      ]),
    ),
    scriptsDir: `${folder}/scripts`,
    scriptPath: `${folder}/webview.js`,
  };
}

describe('buildComponentCatalog', () => {
  it('lists every standard component first, in declaration order', () => {
    const catalog = buildComponentCatalog([]);
    const standardNames = catalog
      .filter((entry) => entry.source === 'standard')
      .map((entry) => entry.directiveName);
    expect(standardNames).toEqual(Object.keys(STANDARD_COMPONENTS));
  });

  it('carries each standard component contract kind and required attributes through', () => {
    const catalog = buildComponentCatalog([]);
    const figure = catalog.find((entry) => entry.directiveName === 'figure');
    expect(figure?.kind).toBe('container');
    expect(figure?.requiredAttributes).toEqual(['src']);

    const kbd = catalog.find((entry) => entry.directiveName === 'kbd');
    expect(kbd?.kind).toBe('inline');
    expect(kbd?.requiredAttributes).toEqual([]);
  });

  it('truncates a standard description to its first sentence', () => {
    const catalog = buildComponentCatalog([]);
    const callout = catalog.find((entry) => entry.directiveName === 'callout');
    expect(callout?.description).toBe(
      'A colored box for an aside, warning, or danger note.',
    );
    expect(callout?.description?.length).toBeLessThan(
      STANDARD_COMPONENTS.callout!.description.length,
    );
  });

  it('appends pack components after the standard set, namespaced', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx', timeline: './Timeline.tsx' }),
    ]);
    const packEntries = catalog.filter((entry) => entry.source === 'pack');
    expect(packEntries.map((entry) => entry.directiveName)).toEqual([
      'cat_card',
      'cat_timeline',
    ]);
    expect(packEntries[0]).toMatchObject({
      kind: 'container',
      group: 'pack',
      packName: 'cat',
      requiredAttributes: [],
    });
    // No manifest-declared description (string-shorthand entry): the
    // catalog carries no filler text, unlike the old "From pack ..." string.
    expect(packEntries[0]?.description).toBeUndefined();
  });

  it('appends the layout wrappers after the standard set and before packs', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]);
    const names = catalog.map((entry) => entry.directiveName);
    const layoutStart = names.indexOf('center');
    const packStart = names.indexOf('cat_card');
    expect(layoutStart).toBeGreaterThan(-1);
    expect(packStart).toBeGreaterThan(layoutStart);
    for (const layoutName of LAYOUT_WRAPPER_NAMES) {
      const entry = catalog.find((e) => e.directiveName === layoutName);
      expect(entry?.group).toBe('layout');
      expect(entry?.source).toBe('standard');
    }
  });

  it('carries a pack component object-form description and kind through', () => {
    const catalog = buildComponentCatalog([
      pack('cat', {
        profile: {
          source: './Profile.tsx',
          description: 'A cat profile card.',
          kind: 'leaf',
        },
      }),
    ]);
    const entry = catalog.find((e) => e.directiveName === 'cat_profile');
    expect(entry).toMatchObject({
      kind: 'leaf',
      group: 'pack',
      packName: 'cat',
      description: 'A cat profile card.',
    });
  });

  it('defaults a pack component with no declared kind to container', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: { source: './Card.tsx' } }),
    ]);
    const entry = catalog.find((e) => e.directiveName === 'cat_card');
    expect(entry?.kind).toBe('container');
  });

  it('marks kindDeclared false for a pack component with no declared kind', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: { source: './Card.tsx' } }),
    ]);
    const entry = catalog.find((e) => e.directiveName === 'cat_card');
    expect(entry?.kindDeclared).toBe(false);
  });

  it('marks kindDeclared true for a pack component whose manifest declares kind', () => {
    const catalog = buildComponentCatalog([
      pack('cat', {
        profile: {
          source: './Profile.tsx',
          kind: 'leaf',
        },
      }),
    ]);
    const entry = catalog.find((e) => e.directiveName === 'cat_profile');
    expect(entry?.kindDeclared).toBe(true);
  });

  it('marks kindDeclared true for every standard component', () => {
    const catalog = buildComponentCatalog([]);
    for (const entry of catalog.filter((e) => e.source === 'standard')) {
      expect(entry.kindDeclared).toBe(true);
    }
  });

  it("sorts a pack's own local names alphabetically", () => {
    const catalog = buildComponentCatalog([
      pack('cat', { zeta: './Z.tsx', alpha: './A.tsx' }),
    ]);
    const names = catalog
      .filter((entry) => entry.source === 'pack')
      .map((entry) => entry.directiveName);
    expect(names).toEqual(['cat_alpha', 'cat_zeta']);
  });

  it('processes packs in the given order', () => {
    const catalog = buildComponentCatalog([
      pack('bpack', { widget: './W.tsx' }),
      pack('apack', { widget: './W.tsx' }),
    ]);
    const names = catalog
      .filter((entry) => entry.source === 'pack')
      .map((entry) => entry.directiveName);
    expect(names).toEqual(['bpack_widget', 'apack_widget']);
  });

  it('composes a pack namespace and local name that do not collide with anything', () => {
    const catalog = buildComponentCatalog([pack('kbd', { x: './X.tsx' })]);
    expect(
      catalog
        .filter((entry) => entry.source === 'pack')
        .map((entry) => entry.directiveName),
    ).toEqual(['kbd_x']);
  });

  it('skips a pack component whose composed name collides with an earlier pack (first wins)', () => {
    // With the underscore join, pack "a" + local "b-c" composes to
    // "a_b-c" and pack "a-b" + local "c" composes to "a-b_c" — these are
    // now DIFFERENT names, so composition itself can no longer produce
    // this collision. This test instead forces a collision by giving two
    // packs the exact same declared pack name (which composeDirectiveName
    // treats identically regardless of local-name shape), to prove the
    // first-wins skip logic in `packCatalogEntries`/`buildComponentCatalog`
    // still works now that natural ambiguity is gone.
    const catalog = buildComponentCatalog([
      pack('a', { widget: './One.tsx' }, '/packs/a-1'),
      pack('a', { widget: './Two.tsx' }, '/packs/a-2'),
    ]);
    const names = catalog
      .filter((entry) => entry.source === 'pack')
      .map((entry) => entry.directiveName);
    expect(names).toEqual(['a_widget']);
    const first = catalog.find((entry) => entry.directiveName === 'a_widget');
    expect(first?.packName).toBe('a');
  });

  it('keeps the standard entry untouched when a pack namespace equals a standard directive name', () => {
    const catalog = buildComponentCatalog([
      pack('callout', { extra: './E.tsx' }),
    ]);
    const calloutEntries = catalog.filter(
      (entry) => entry.directiveName === 'callout',
    );
    expect(calloutEntries).toHaveLength(1);
    expect(calloutEntries[0]?.source).toBe('standard');
  });

  it('skips a pack with an empty components map', () => {
    const catalog = buildComponentCatalog([pack('empty', {})]);
    expect(catalog.filter((entry) => entry.source === 'pack')).toEqual([]);
  });

  it('skips a pack component whose local name fails namespace validation', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { Invalid_Name: './X.tsx' }),
    ]);
    expect(catalog.filter((entry) => entry.source === 'pack')).toEqual([]);
  });

  it('never throws for a malformed pack manifest', () => {
    const malformed = pack('bad', {});
    // @ts-expect-error -- deliberately hostile shape to prove this never throws
    malformed.manifest.components = undefined;
    expect(() => buildComponentCatalog([malformed])).not.toThrow();
  });

  it('marks every non-layout standard entry group as "standard"', () => {
    const catalog = buildComponentCatalog([]);
    for (const entry of catalog.filter((e) => e.source === 'standard')) {
      if (LAYOUT_WRAPPER_NAMES.includes(entry.directiveName)) continue;
      expect(entry.group).toBe('standard');
    }
  });
});

describe('LAYOUT_WRAPPER_NAMES', () => {
  it('names exactly seven wrappers, each a real container-kind, attribute-free standard component', () => {
    expect(LAYOUT_WRAPPER_NAMES).toHaveLength(7);
    for (const name of LAYOUT_WRAPPER_NAMES) {
      const contract = STANDARD_COMPONENTS[name];
      expect(
        contract,
        `expected "${name}" in STANDARD_COMPONENTS`,
      ).toBeDefined();
      expect(contract?.kind).toBe('container');
      expect(Object.keys(contract?.attributes ?? {})).toEqual([]);
    }
  });

  it('names one wrapper per align preset and per non-default width preset', () => {
    // The wrappers exist so a layout preset can reach plain markdown that
    // has no `{...}` to write `width=`/`align=` into, so a preset without a
    // wrapper is a hole in that story. `normal` is deliberately absent: the
    // default needs no wrapper at all.
    const expected = [
      ...ALIGN_PRESETS,
      ...WIDTH_PRESETS.filter((preset) => preset !== 'normal'),
    ].sort();
    expect([...LAYOUT_WRAPPER_NAMES].sort()).toEqual(expected);
  });
});

/**
 * Regression guard for the first-sentence truncation, run against the REAL
 * `STANDARD_COMPONENTS` prose rather than synthetic strings.
 *
 * The original implementation split on the first ". " and so cut 19 of the
 * 20 standard components at the period inside "e.g.", leaving picker rows
 * reading "A titled panel, e.g." — the example, the half that actually
 * tells an author how to write the directive, was the part discarded.
 * Synthetic-description tests all passed while every real row was broken,
 * which is exactly why these assertions bind to the shipped contracts.
 */
describe('buildComponentCatalog — description truncation against real contracts', () => {
  const standard = buildComponentCatalog([]).filter(
    (entry) => entry.source === 'standard',
  );

  it('covers every standard component', () => {
    expect(standard).toHaveLength(Object.keys(STANDARD_COMPONENTS).length);
  });

  it('never ends a description at an abbreviation such as "e.g."', () => {
    const offenders = standard
      .filter((entry) => /\b(e\.g|i\.e|etc)\.$/.test(entry.description ?? ''))
      .map((entry) => `${entry.directiveName}: ${entry.description}`);
    expect(offenders).toEqual([]);
  });

  it('keeps the example clause for every component whose prose has one', () => {
    const missingExample = standard
      .filter((entry) => {
        const contract = STANDARD_COMPONENTS[entry.directiveName];
        if (contract === undefined) return false;
        if (!contract.description.includes('e.g. ')) return false;
        // The example is written as inline code right after "e.g. ", so a
        // surviving example always carries at least one backtick.
        return !(entry.description ?? '').includes('`');
      })
      .map((entry) => `${entry.directiveName}: ${entry.description}`);
    expect(missingExample).toEqual([]);
  });

  it('still truncates: no row carries the contract prose whole', () => {
    const untruncated = standard
      .filter((entry) => {
        const contract = STANDARD_COMPONENTS[entry.directiveName];
        if (contract === undefined) return false;
        // `callout` and any other genuinely one-sentence description are
        // legitimately returned unchanged; only flag prose that HAS a
        // later sentence and kept it anyway.
        return (
          /\.\s+[A-Z]/.test(contract.description) &&
          entry.description === contract.description
        );
      })
      .map((entry) => entry.directiveName);
    expect(untruncated).toEqual([]);
  });
});

describe('buildComponentCatalog: declared pack attributes (issue #27 slice 4)', () => {
  const withAttributes = pack('ana', {
    timeline: {
      source: './Timeline.tsx',
      kind: 'container',
      attributes: [
        { name: 'from', description: 'First date shown.', required: true },
        { name: 'to', required: true },
        { name: 'scale', values: ['days', 'weeks'], default: 'days' },
      ],
    },
  });

  it('carries the declared attribute list onto the catalog entry', () => {
    const entry = buildComponentCatalog([withAttributes]).find(
      (candidate) => candidate.directiveName === 'ana_timeline',
    );
    expect(entry?.attributes).toEqual([
      { name: 'from', description: 'First date shown.', required: true },
      { name: 'to', required: true },
      { name: 'scale', values: ['days', 'weeks'], default: 'days' },
    ]);
  });

  it('derives requiredAttributes from the declared list, in declaration order', () => {
    const entry = buildComponentCatalog([withAttributes]).find(
      (candidate) => candidate.directiveName === 'ana_timeline',
    );
    expect(entry?.requiredAttributes).toEqual(['from', 'to']);
  });

  it('leaves attributes absent and requiredAttributes empty for a pack that declares none', () => {
    const entry = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]).find((candidate) => candidate.directiveName === 'cat_card');
    expect(entry?.attributes).toBeUndefined();
    expect(entry?.requiredAttributes).toEqual([]);
  });

  it('drops a malformed declared attribute rather than throwing', () => {
    const entry = buildComponentCatalog([
      pack('cat', {
        // Parsed from text rather than written as a literal: this is the
        // shape a hostile or hand-edited pack.json really arrives in, and
        // it is not assignable to `PackComponentEntry` by construction.
        card: JSON.parse(
          '{"source":"./Card.tsx","attributes":["not an object",{"name":"Mood"},{"name":"mood"}]}',
        ) as PackComponentEntry,
      }),
    ]).find((candidate) => candidate.directiveName === 'cat_card');
    expect(entry?.attributes).toEqual([{ name: 'mood' }]);
  });
});
