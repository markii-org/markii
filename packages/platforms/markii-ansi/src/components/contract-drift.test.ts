import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STANDARD_COMPONENTS,
  getContract,
  layoutWrapperAxis,
  otherLayoutAxis,
} from '@markii/stdlib';
import type { ComponentContract } from '@markii/stdlib';
import { defaultAnsiRegistry } from './index.js';

/**
 * The `@markii/ansi` port of `@markii/react`'s `contract-drift.test.ts`:
 * guards `@markii/stdlib`'s `STANDARD_COMPONENTS` contracts against drifting
 * away from what THIS engine's real components actually read. Scans `.ts`
 * source (not `.tsx`), since this engine's components are plain functions,
 * not JSX.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function readSource(fileName: string): string {
  return readFileSync(path.join(here, fileName), 'utf8');
}

/** Matches `attributes.<key>` (the component's own destructured/direct parameter), not a nested read off some other object. */
const OWN_ATTRIBUTE_READ = /(?<!\.)\battributes\.([A-Za-z_$][\w$]*)/g;

/** Matches `Object.hasOwn(attributes, 'key')` — how a BARE attribute (e.g. `{open}`) is read: `details.ts` reads `open` this way. */
const OWN_ATTRIBUTE_HAS_OWN_READ =
  /\bObject\.hasOwn\(attributes,\s*['"]([A-Za-z_$][\w$]*)['"]\)/g;

/** Matches `attributes['some-key']` — the bracket-access form for a HYPHENATED key (`divider.ts`'s `label-align`). */
const OWN_ATTRIBUTE_BRACKET_READ =
  /(?<!\.)\battributes\[\s*['"]([A-Za-z_$][\w$-]*)['"]\s*\]/g;

function extractMatches(source: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}

/**
 * For every standard component, which source file to scan. Unlike
 * `@markii/react`'s copy, `tab` needs no `childDirective` exemption here:
 * this engine's `tab` component reads its OWN `label` attribute directly
 * (it is rendered as its own directive, not inspected from `tabs` — see
 * `tab.ts`'s doc comment for why that differs from `@markii/html`/
 * `@markii/react`'s string/JSX-children limitation).
 *
 * The layout wrappers all share `layout-wrapper.ts`, which reads nothing
 * off `attributes` at all — their one declared attribute (the axis the
 * wrapper's name did not decide) is satisfied by `render.ts` handing it down
 * as `ctx.layout` instead; `rendererHandledAttributes` below adds it back.
 */
const ATTRIBUTE_READ_SOURCES: Record<string, string[]> = {
  callout: ['callout.ts'],
  kbd: ['kbd.ts'],
  rating: ['rating.ts'],
  divider: ['divider.ts'],
  details: ['details.ts'],
  card: ['card.ts'],
  badge: ['badge.ts'],
  figure: ['figure.ts'],
  tabs: ['tabs.ts'],
  tab: ['tab.ts'],
  stat: ['stat.ts'],
  progress: ['progress.ts'],
  chart: ['chart.ts'],
  row: ['row.ts'],
  cell: ['cell.ts'],
  table: ['table.ts'],
  center: ['layout-wrapper.ts'],
  left: ['layout-wrapper.ts'],
  right: ['layout-wrapper.ts'],
  wide: ['layout-wrapper.ts'],
  narrow: ['layout-wrapper.ts'],
  full: ['layout-wrapper.ts'],
  fit: ['layout-wrapper.ts'],
};

/**
 * The attribute keys a component's contract declares that the RENDERER
 * satisfies on its behalf: exactly a layout wrapper's un-owned axis, handed
 * down as `ctx.layout` by `render.ts` rather than read off `attributes`.
 */
function rendererHandledAttributes(name: string): Set<string> {
  const ownAxis = layoutWrapperAxis(name);
  return ownAxis === undefined
    ? new Set<string>()
    : new Set([otherLayoutAxis(ownAxis)]);
}

/** The set of attribute keys `name`'s implementation actually reads, per `ATTRIBUTE_READ_SOURCES`. */
function actualAttributeReads(name: string): Set<string> {
  const files = ATTRIBUTE_READ_SOURCES[name];
  if (!files) {
    throw new Error(
      `contract-drift.test.ts has no ATTRIBUTE_READ_SOURCES entry for "${name}" — ` +
        'add one (see the "New stdlib component" maintenance-map entry).',
    );
  }
  const reads = new Set<string>();
  for (const file of files) {
    const source = readSource(file);
    for (const key of extractMatches(source, OWN_ATTRIBUTE_READ))
      reads.add(key);
    for (const key of extractMatches(source, OWN_ATTRIBUTE_HAS_OWN_READ)) {
      reads.add(key);
    }
    for (const key of extractMatches(source, OWN_ATTRIBUTE_BRACKET_READ)) {
      reads.add(key);
    }
  }
  for (const key of rendererHandledAttributes(name)) reads.add(key);
  return reads;
}

/** The set of attribute keys `contract` declares. */
function contractAttributeKeys(contract: ComponentContract): Set<string> {
  return new Set(Object.keys(contract.attributes));
}

function formatSet(set: Set<string>): string {
  return set.size === 0 ? '{}' : `{${[...set].sort().join(', ')}}`;
}

describe('STANDARD_COMPONENTS vs defaultAnsiRegistry — coverage', () => {
  it('every defaultAnsiRegistry name has a standard contract', () => {
    const missing = Object.keys(defaultAnsiRegistry).filter(
      (name) => getContract(name) === undefined,
    );
    expect(missing, `missing contracts for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every STANDARD_COMPONENTS name is registered in defaultAnsiRegistry', () => {
    const missing = Object.keys(STANDARD_COMPONENTS).filter(
      (name) => defaultAnsiRegistry[name] === undefined,
    );
    expect(missing, `missing registrations for: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('covers exactly the 23 standard components', () => {
    expect(Object.keys(defaultAnsiRegistry).sort()).toEqual(
      Object.keys(STANDARD_COMPONENTS).sort(),
    );
    expect(Object.keys(defaultAnsiRegistry)).toHaveLength(23);
  });
});

describe('STANDARD_COMPONENTS vs defaultAnsiRegistry — kind/inline agreement', () => {
  for (const name of Object.keys(STANDARD_COMPONENTS)) {
    it(`${name}: contract kind === 'inline' iff registry inline === true`, () => {
      const contract = getContract(name);
      expect(contract).toBeDefined();
      const expectedInline = contract?.kind === 'inline';
      expect(defaultAnsiRegistry[name]?.inline).toBe(expectedInline);
    });
  }
});

describe('STANDARD_COMPONENTS vs component implementations — attribute-name drift', () => {
  for (const name of Object.keys(STANDARD_COMPONENTS)) {
    it(`${name}: contract attribute keys match the keys the implementation reads`, () => {
      const contract = STANDARD_COMPONENTS[name];
      if (!contract) throw new Error(`no contract for "${name}"`);
      const declared = contractAttributeKeys(contract);
      const actual = actualAttributeReads(name);
      expect(
        actual,
        `"${name}": contract declares ${formatSet(declared)} but the ` +
          `implementation reads ${formatSet(actual)} — a component that ` +
          `reads an attribute the contract doesn't declare (or declares ` +
          `one it never reads) is drift.`,
      ).toEqual(declared);
    });
  }

  it('components with declared attributes have a non-empty extracted read set (regex sanity)', () => {
    const componentsWithAttributes = Object.values(STANDARD_COMPONENTS)
      .filter((contract) => Object.keys(contract.attributes).length > 0)
      .map((contract) => contract.name);

    expect(componentsWithAttributes.length).toBeGreaterThan(0);

    const empty = componentsWithAttributes.filter(
      (name) => actualAttributeReads(name).size === 0,
    );
    expect(
      empty,
      `expected a non-empty read set for: ${empty.join(', ')} — the ` +
        'extraction regex is not matching real attribute reads',
    ).toEqual([]);
  });

  it('kbd and tabs read no attributes', () => {
    for (const name of ['kbd', 'tabs']) {
      expect(actualAttributeReads(name), name).toEqual(new Set());
      expect(contractAttributeKeys(STANDARD_COMPONENTS[name]!), name).toEqual(
        new Set(),
      );
    }
  });

  it('the shared layout-wrapper implementation reads no attributes at all, which is what the renderer-handled exemption assumes', () => {
    const source = readSource('layout-wrapper.ts');
    expect(extractMatches(source, OWN_ATTRIBUTE_READ)).toEqual(new Set());
    expect(extractMatches(source, OWN_ATTRIBUTE_HAS_OWN_READ)).toEqual(
      new Set(),
    );
    expect(extractMatches(source, OWN_ATTRIBUTE_BRACKET_READ)).toEqual(
      new Set(),
    );
  });

  it('each layout wrapper is credited with exactly the axis its name did not decide', () => {
    expect(actualAttributeReads('center')).toEqual(new Set(['width']));
    expect(actualAttributeReads('right')).toEqual(new Set(['width']));
    expect(actualAttributeReads('left')).toEqual(new Set(['width']));
    expect(actualAttributeReads('fit')).toEqual(new Set(['align']));
    expect(actualAttributeReads('narrow')).toEqual(new Set(['align']));
    expect(actualAttributeReads('wide')).toEqual(new Set(['align']));
    expect(actualAttributeReads('full')).toEqual(new Set(['align']));
  });

  it('the renderer-handled exemption applies to layout wrappers only', () => {
    for (const name of Object.keys(STANDARD_COMPONENTS)) {
      if (layoutWrapperAxis(name) !== undefined) continue;
      expect(rendererHandledAttributes(name), name).toEqual(new Set());
    }
  });

  it('the five text-accepting components really read the text attribute', () => {
    for (const name of ['row', 'cell', 'card', 'callout', 'table']) {
      expect(actualAttributeReads(name).has('text'), name).toBe(true);
    }
  });

  it('self-test: this drift check actually fails on a mutated contract (proves it is a real guard, not a tautology)', () => {
    const realCalloutContract = STANDARD_COMPONENTS.callout;
    if (!realCalloutContract) throw new Error('expected a callout contract');
    const mutatedAttributes = { ...realCalloutContract.attributes };
    delete mutatedAttributes.title;
    const mutatedDeclared = new Set(Object.keys(mutatedAttributes));
    const actual = actualAttributeReads('callout');

    expect(actual).not.toEqual(mutatedDeclared);
    expect(actual.has('title')).toBe(true);
    expect(mutatedDeclared.has('title')).toBe(false);
  });

  it('self-test: details picks up its bare `open` attribute via the Object.hasOwn read pattern', () => {
    const reads = actualAttributeReads('details');
    expect(reads.has('open')).toBe(true);
    expect(reads.has('title')).toBe(true);
  });

  it('self-test: divider picks up its hyphenated `label-align` attribute via the bracket-read pattern', () => {
    const reads = actualAttributeReads('divider');
    expect(reads.has('label-align')).toBe(true);
    expect(reads.has('label')).toBe(true);
    expect(reads.has('variant')).toBe(true);
  });

  it('tab reads its own label attribute directly (unlike @markii/html/@markii/react)', () => {
    expect(actualAttributeReads('tab').has('label')).toBe(true);
  });
});
