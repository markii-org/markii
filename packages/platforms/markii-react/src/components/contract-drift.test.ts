import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STANDARD_COMPONENTS, getContract } from '@markii/stdlib';
import type { ComponentContract } from '@markii/stdlib';
import { defaultRegistry } from './index.js';

/**
 * Guards `@markii/stdlib`'s `STANDARD_COMPONENTS` contracts against drifting
 * away from what `@markii/react`'s real components actually do — the seam
 * every renderer implements against (AGENTS.md) is only trustworthy if a
 * mismatch here fails a test, not just a code-review spot check. This
 * suite was added as part of the issue #17 slice 2 audit, which found the
 * contracts already matched the implementations exactly; it exists so the
 * NEXT drift (a component gaining/losing an attribute, or a contract
 * changing without the implementation following) is caught automatically.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function readSource(fileName: string): string {
  return readFileSync(path.join(here, fileName), 'utf8');
}

/**
 * Matches `attributes.<key>` where `attributes` is the component's OWN
 * destructured prop (per `MarkComponentProps`), not a nested read off some
 * other object. The negative lookbehind excludes `directive.attributes.foo`
 * (`tabs.tsx`'s read of a CHILD `tab` directive's attributes) — without it,
 * this regex would misattribute `tab`'s `label` attribute to `tabs` itself,
 * since the literal substring `attributes.label` still appears in
 * `directive.attributes.label`.
 */
const OWN_ATTRIBUTE_READ = /(?<!\.)\battributes\.([A-Za-z_$][\w$]*)/g;

/**
 * Matches `directive.attributes.<key>` — `tabs.tsx`'s `collectTabs` reading
 * a child `tab` directive's attributes off its not-yet-rendered React
 * element (`readDirectiveChild`), the one case in this registry where a
 * component's attribute reads live in a file other than its own
 * (`tab.tsx` never reads `label`; `tabs.tsx` does, on `tab`'s behalf).
 */
const CHILD_DIRECTIVE_ATTRIBUTE_READ =
  /\bdirective\.attributes\.([A-Za-z_$][\w$]*)/g;

/**
 * Matches `Object.hasOwn(attributes, 'key')` — how a BARE attribute (one
 * with no value, e.g. `{open}`) is read: `details.tsx` reads `open` this
 * way rather than `attributes.open`, since a bare attribute's presence is
 * what matters, not a string value to destructure. `OWN_ATTRIBUTE_READ`
 * alone would miss this read entirely, which is exactly the false-negative
 * the "self-test" below exists to catch.
 */
const OWN_ATTRIBUTE_HAS_OWN_READ =
  /\bObject\.hasOwn\(attributes,\s*['"]([A-Za-z_$][\w$]*)['"]\)/g;

/**
 * Matches `attributes['some-key']` (or double-quoted) — the bracket-access
 * form a component is forced to use for a HYPHENATED attribute key, since
 * `attributes.label-align` is not a valid property access. `divider.tsx`
 * reads `label-align` this way; `OWN_ATTRIBUTE_READ`'s `\w` character class
 * cannot match a hyphen at all, so without this pattern that read would be
 * invisible to `actualAttributeReads` and the drift check below would
 * falsely report the contract's `label-align` entry as unread.
 */
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
 * For every standard component, which source file(s) to scan and how to
 * read its attribute keys off them. Most components read their own
 * `attributes` prop directly, so `own: [file]` covers them. `tab` is the
 * one exception (see `CHILD_DIRECTIVE_ATTRIBUTE_READ`'s doc comment): its
 * `label` is read out of `tabs.tsx`, keyed on the child directive's
 * `attributes`, not on `tab.tsx`'s own `attributes` prop (which `tab.tsx`
 * never even destructures).
 *
 * The layout wrappers (`center`/`left`/`right`/`wide`/`narrow`/`full`/`fit`)
 * all share `layout-wrapper.tsx`, which never reads `attributes` at all —
 * scanning it for every one of them is expected to yield the empty set.
 * `tabs`, `cell`, and `kbd` likewise read no attributes of their own.
 */
interface AttributeReadSpec {
  /** Files scanned with `OWN_ATTRIBUTE_READ`. */
  own?: string[];
  /** Files scanned with `CHILD_DIRECTIVE_ATTRIBUTE_READ`, attributed to THIS component. */
  childDirective?: string[];
}

const ATTRIBUTE_READ_SOURCES: Record<string, AttributeReadSpec> = {
  callout: { own: ['callout.tsx'] },
  kbd: { own: ['kbd.tsx'] },
  rating: { own: ['rating.tsx'] },
  divider: { own: ['divider.tsx'] },
  details: { own: ['details.tsx'] },
  card: { own: ['card.tsx'] },
  badge: { own: ['badge.tsx'] },
  figure: { own: ['figure.tsx'] },
  tabs: { own: ['tabs.tsx'] },
  tab: { childDirective: ['tabs.tsx'] },
  stat: { own: ['stat.tsx'] },
  progress: { own: ['progress.tsx'] },
  chart: { own: ['chart.tsx'] },
  row: { own: ['row.tsx'] },
  cell: { own: ['cell.tsx'] },
  center: { own: ['layout-wrapper.tsx'] },
  left: { own: ['layout-wrapper.tsx'] },
  right: { own: ['layout-wrapper.tsx'] },
  wide: { own: ['layout-wrapper.tsx'] },
  narrow: { own: ['layout-wrapper.tsx'] },
  full: { own: ['layout-wrapper.tsx'] },
  fit: { own: ['layout-wrapper.tsx'] },
};

/** The set of attribute keys `name`'s implementation actually reads, per `ATTRIBUTE_READ_SOURCES`. */
function actualAttributeReads(name: string): Set<string> {
  const spec = ATTRIBUTE_READ_SOURCES[name];
  if (!spec) {
    throw new Error(
      `contract-drift.test.ts has no ATTRIBUTE_READ_SOURCES entry for "${name}" — ` +
        'add one (see the "New stdlib component" maintenance-map entry).',
    );
  }
  const reads = new Set<string>();
  for (const file of spec.own ?? []) {
    const source = readSource(file);
    for (const key of extractMatches(source, OWN_ATTRIBUTE_READ)) {
      reads.add(key);
    }
    for (const key of extractMatches(source, OWN_ATTRIBUTE_HAS_OWN_READ)) {
      reads.add(key);
    }
    for (const key of extractMatches(source, OWN_ATTRIBUTE_BRACKET_READ)) {
      reads.add(key);
    }
  }
  for (const file of spec.childDirective ?? []) {
    for (const key of extractMatches(
      readSource(file),
      CHILD_DIRECTIVE_ATTRIBUTE_READ,
    )) {
      reads.add(key);
    }
  }
  return reads;
}

/** The set of attribute keys `contract` declares. */
function contractAttributeKeys(contract: ComponentContract): Set<string> {
  return new Set(Object.keys(contract.attributes));
}

function formatSet(set: Set<string>): string {
  return set.size === 0 ? '{}' : `{${[...set].sort().join(', ')}}`;
}

describe('STANDARD_COMPONENTS vs defaultRegistry — coverage', () => {
  it('every defaultRegistry name has a standard contract', () => {
    const missing = Object.keys(defaultRegistry).filter(
      (name) => getContract(name) === undefined,
    );
    expect(missing, `missing contracts for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every STANDARD_COMPONENTS name is registered in defaultRegistry', () => {
    const missing = Object.keys(STANDARD_COMPONENTS).filter(
      (name) => defaultRegistry[name] === undefined,
    );
    expect(missing, `missing registrations for: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('covers exactly the 22 standard components (the 20 audited for issue #17 slice 2, plus divider and the fit layout wrapper)', () => {
    // Not a load-bearing count on its own — the two tests above already
    // prove the sets are equal both ways — but pins the number so a
    // component silently added to one side and removed from the other
    // (net zero, therefore invisible to the coverage tests) still shows up
    // as a diff here.
    expect(Object.keys(defaultRegistry).sort()).toEqual(
      Object.keys(STANDARD_COMPONENTS).sort(),
    );
    expect(Object.keys(defaultRegistry)).toHaveLength(22);
  });
});

describe('STANDARD_COMPONENTS vs defaultRegistry — kind/inline agreement', () => {
  // `defaultRegistry`'s `inline` flag is DERIVED from the contract's `kind`
  // (`inlineFromContract` in `./index.ts`), so this can only catch a future
  // hand-edit that breaks that derivation — it cannot catch a `kind` that
  // was wrong in the contract to begin with, since both sides would then
  // agree on the same wrong value. `kind` correctness itself was checked
  // against docs/format.md and the conformance corpus during the issue #17
  // slice 2 audit, not by this test.
  for (const name of Object.keys(STANDARD_COMPONENTS)) {
    it(`${name}: contract kind === 'inline' iff registry inline === true`, () => {
      const contract = getContract(name);
      expect(contract).toBeDefined();
      const expectedInline = contract?.kind === 'inline';
      expect(defaultRegistry[name]?.inline).toBe(expectedInline);
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

  // Vacuity check: a regex that silently matched nothing would make every
  // assertion above pass trivially (empty === empty) for every component,
  // never actually proving the comparison ran. Every component whose
  // contract declares at least one attribute must have a NON-EMPTY
  // extracted read set, or this suite is not a real guard.
  it('components with declared attributes have a non-empty extracted read set (regex sanity)', () => {
    const componentsWithAttributes = Object.values(STANDARD_COMPONENTS)
      .filter((contract) => Object.keys(contract.attributes).length > 0)
      .map((contract) => contract.name);

    // Sanity on the sanity check: this list must itself be non-empty, or
    // the assertion below would vacuously pass for an empty list.
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

  // Components genuinely expected to read NO attributes: confirms the
  // empty result for these is deliberate (per ATTRIBUTE_READ_SOURCES'
  // comment), not a byproduct of the regex failing to match.
  it('kbd, tabs, cell, and every layout wrapper read no attributes', () => {
    for (const name of [
      'kbd',
      'tabs',
      'cell',
      'center',
      'left',
      'right',
      'wide',
      'narrow',
      'full',
      'fit',
    ]) {
      expect(actualAttributeReads(name), name).toEqual(new Set());
      expect(contractAttributeKeys(STANDARD_COMPONENTS[name]!), name).toEqual(
        new Set(),
      );
    }
  });

  it('self-test: this drift check actually fails on a mutated contract (proves it is a real guard, not a tautology)', () => {
    const realCalloutContract = STANDARD_COMPONENTS.callout;
    if (!realCalloutContract) throw new Error('expected a callout contract');
    const mutatedAttributes = { ...realCalloutContract.attributes };
    delete mutatedAttributes.title; // callout.tsx genuinely reads `attributes.title`
    const mutatedDeclared = new Set(Object.keys(mutatedAttributes));
    const actual = actualAttributeReads('callout');

    expect(actual).not.toEqual(mutatedDeclared);
    expect(actual.has('title')).toBe(true);
    expect(mutatedDeclared.has('title')).toBe(false);
  });

  it('self-test: details picks up its bare `open` attribute via the Object.hasOwn read pattern', () => {
    // `details.tsx` reads `open` as `Object.hasOwn(attributes, 'open')`, not
    // `attributes.open` — proves OWN_ATTRIBUTE_HAS_OWN_READ is doing real
    // work, not just OWN_ATTRIBUTE_READ.
    const reads = actualAttributeReads('details');
    expect(reads.has('open')).toBe(true);
    expect(reads.has('title')).toBe(true);
  });

  it('self-test: divider picks up its hyphenated `label-align` attribute via the bracket-read pattern', () => {
    // `divider.tsx` reads `label-align` as `attributes['label-align']`, not
    // `attributes.label-align` (which is not valid syntax) — proves
    // OWN_ATTRIBUTE_BRACKET_READ is doing real work, not just
    // OWN_ATTRIBUTE_READ.
    const reads = actualAttributeReads('divider');
    expect(reads.has('label-align')).toBe(true);
    expect(reads.has('label')).toBe(true);
    expect(reads.has('variant')).toBe(true);
  });

  it('self-test: the own-attribute regex does not misattribute a child directive read (tabs vs tab)', () => {
    // `directive.attributes.label` appears verbatim in tabs.tsx; the own-
    // attribute regex must not pick up `label` for `tabs` itself.
    expect(actualAttributeReads('tabs').has('label')).toBe(false);
    // ...while the child-directive regex, scanning the same file, attributes
    // it correctly to `tab`.
    expect(actualAttributeReads('tab').has('label')).toBe(true);
  });
});
