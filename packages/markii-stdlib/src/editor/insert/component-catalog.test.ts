import { describe, expect, it } from 'vitest';
import {
  ALIGN_PRESETS,
  STANDARD_COMPONENTS,
  WIDTH_PRESETS,
  layoutWrapperAxis,
  otherLayoutAxis,
} from '../../index.js';
import {
  LAYOUT_WRAPPER_NAMES,
  standardComponentCatalog,
} from './component-catalog.js';

describe('standardComponentCatalog', () => {
  it('lists every standard component first, in declaration order', () => {
    const catalog = standardComponentCatalog();
    const standardNames = catalog
      .filter((entry) => entry.source === 'standard')
      .map((entry) => entry.directiveName);
    expect(standardNames).toEqual(Object.keys(STANDARD_COMPONENTS));
  });

  it('picks up a new standard component (table) with no catalog code change, since it iterates STANDARD_COMPONENTS directly', () => {
    const catalog = standardComponentCatalog();
    const table = catalog.find((entry) => entry.directiveName === 'table');
    expect(table).toBeDefined();
    expect(table?.source).toBe('standard');
    expect(table?.kind).toBe('leaf');
  });

  it('carries each standard component contract kind and required attributes through', () => {
    const catalog = standardComponentCatalog();
    const figure = catalog.find((entry) => entry.directiveName === 'figure');
    expect(figure?.kind).toBe('container');
    expect(figure?.requiredAttributes).toEqual(['src']);

    const kbd = catalog.find((entry) => entry.directiveName === 'kbd');
    expect(kbd?.kind).toBe('inline');
    expect(kbd?.requiredAttributes).toEqual([]);
  });

  it('truncates a standard description to its first sentence', () => {
    const catalog = standardComponentCatalog();
    const callout = catalog.find((entry) => entry.directiveName === 'callout');
    expect(callout?.description).toBe(
      'A colored box for an aside, warning, or danger note.',
    );
    expect(callout?.description?.length).toBeLessThan(
      STANDARD_COMPONENTS.callout!.description.length,
    );
  });

  it('places the layout wrappers after the standard set', () => {
    const catalog = standardComponentCatalog();
    const names = catalog.map((entry) => entry.directiveName);
    const layoutStart = names.indexOf('center');
    expect(layoutStart).toBeGreaterThan(-1);
    for (const layoutName of LAYOUT_WRAPPER_NAMES) {
      const entry = catalog.find((e) => e.directiveName === layoutName);
      expect(entry?.group).toBe('layout');
      expect(entry?.source).toBe('standard');
    }
  });

  it('marks kindDeclared true for every standard component', () => {
    for (const entry of standardComponentCatalog()) {
      expect(entry.kindDeclared).toBe(true);
    }
  });

  it('marks every non-layout standard entry group as "standard"', () => {
    for (const entry of standardComponentCatalog()) {
      if (LAYOUT_WRAPPER_NAMES.includes(entry.directiveName)) continue;
      expect(entry.group).toBe('standard');
    }
  });
});

describe('LAYOUT_WRAPPER_NAMES', () => {
  it('names exactly seven wrappers, each a real container-kind standard component declaring only its open axis', () => {
    expect(LAYOUT_WRAPPER_NAMES).toHaveLength(7);
    for (const name of LAYOUT_WRAPPER_NAMES) {
      const contract = STANDARD_COMPONENTS[name];
      expect(
        contract,
        `expected "${name}" in STANDARD_COMPONENTS`,
      ).toBeDefined();
      expect(contract?.kind).toBe('container');
      const ownAxis = layoutWrapperAxis(name);
      if (ownAxis === undefined) {
        throw new Error(`"${name}" is not a layout-wrapper name`);
      }
      expect(Object.keys(contract?.attributes ?? {})).toEqual([
        otherLayoutAxis(ownAxis),
      ]);
    }
  });

  it('names one wrapper per align preset and per non-default width preset', () => {
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
 */
describe('standardComponentCatalog — description truncation against real contracts', () => {
  const standard = standardComponentCatalog().filter(
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
        return (
          /\.\s+[A-Z]/.test(contract.description) &&
          entry.description === contract.description
        );
      })
      .map((entry) => entry.directiveName);
    expect(untruncated).toEqual([]);
  });
});
