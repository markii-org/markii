import { describe, expect, it } from 'vitest';
import {
  getContract,
  STANDARD_COMPONENTS,
  type ComponentContract,
  type ComponentKind,
} from './contracts';
import {
  ALIGN_PRESETS,
  LAYOUT_ATTRIBUTES,
  WIDTH_PRESETS,
  layoutWrapperAxis,
  otherLayoutAxis,
} from './layout';
import {
  TEXT_ALIGN_ATTRIBUTE,
  TEXT_ALIGN_COMPONENTS,
  TEXT_ALIGN_PRESETS,
} from './text-align';

/** The seven wrapper names, derived from the preset vocabularies rather than re-listed. */
const LAYOUT_WRAPPER_NAMES: readonly string[] = [
  ...ALIGN_PRESETS,
  ...WIDTH_PRESETS.filter((preset) => preset !== 'normal'),
];

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

  it('seeds exactly the twenty-three components that exist in @markii/react today', () => {
    expect(Object.keys(STANDARD_COMPONENTS).sort()).toEqual([
      'badge',
      'callout',
      'card',
      'cell',
      'center',
      'chart',
      'details',
      'divider',
      'figure',
      'fit',
      'full',
      'kbd',
      'left',
      'narrow',
      'progress',
      'rating',
      'right',
      'row',
      'stat',
      'tab',
      'table',
      'tabs',
      'wide',
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

  it('marks divider as a leaf directive, matching its ::divider{...} form', () => {
    expect(STANDARD_COMPONENTS.divider?.kind).toBe('leaf');
  });

  it("divider's variant attribute is a closed enum of exactly line/dots/ornament", () => {
    expect(STANDARD_COMPONENTS.divider?.attributes.variant?.enum).toEqual([
      'line',
      'dots',
      'ornament',
    ]);
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

  it("stat's attributes are exactly value, label, delta, trend, format, and decimals, all optional", () => {
    const attrs = STANDARD_COMPONENTS.stat?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual([
      'decimals',
      'delta',
      'format',
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

  it("progress's attributes are exactly value, max, label, format, and decimals, all optional", () => {
    const attrs = STANDARD_COMPONENTS.progress?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual([
      'decimals',
      'format',
      'label',
      'max',
      'value',
    ]);
    for (const schema of Object.values(attrs)) {
      expect(schema.required).toBeFalsy();
    }
  });

  it("chart's attributes are exactly kind and values, all optional — no pixel width/height (charts size to their container)", () => {
    const attrs = STANDARD_COMPONENTS.chart?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual(['kind', 'values']);
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

  it("row's attributes are cols and text, both optional closed enums", () => {
    const attrs = STANDARD_COMPONENTS.row?.attributes ?? {};
    expect(Object.keys(attrs)).toEqual(['cols', 'text']);
    expect(attrs.cols?.required).toBeFalsy();
    expect(attrs.cols?.enum).toEqual(['2', '3', '4']);
    expect(attrs.text?.required).toBeFalsy();
    expect(attrs.text?.enum).toEqual(TEXT_ALIGN_PRESETS);
  });
  it('marks cell as a container directive whose one attribute is text', () => {
    expect(STANDARD_COMPONENTS.cell?.kind).toBe('container');
    expect(Object.keys(STANDARD_COMPONENTS.cell?.attributes ?? {})).toEqual([
      'text',
    ]);
  });

  it("cell's description explains that it groups several blocks into one row cell", () => {
    const description = STANDARD_COMPONENTS.cell?.description ?? '';
    expect(description).toContain('row');
    expect(description).toContain('ONE cell');
  });

  it.each(TEXT_ALIGN_COMPONENTS)(
    '%s accepts the one shared text attribute, identical on all four',
    (name) => {
      expect(STANDARD_COMPONENTS[name]?.attributes.text).toBe(
        TEXT_ALIGN_ATTRIBUTE,
      );
    },
  );

  it('no component outside that set declares a text attribute', () => {
    const declaring = Object.values(STANDARD_COMPONENTS)
      .filter((contract) => Object.hasOwn(contract.attributes, 'text'))
      .map((contract) => contract.name)
      .sort();
    expect(declaring).toEqual([...TEXT_ALIGN_COMPONENTS].sort());
  });

  it.each(LAYOUT_WRAPPER_NAMES)(
    'marks the %s layout wrapper as a container directive declaring only its open axis',
    (name) => {
      const contract = STANDARD_COMPONENTS[name];
      expect(contract?.kind).toBe('container');
      const ownAxis = layoutWrapperAxis(name);
      if (ownAxis === undefined) {
        throw new Error(`"${name}" is not a layout-wrapper name`);
      }
      const openAxis = otherLayoutAxis(ownAxis);
      expect(contract?.attributes).toEqual({
        [openAxis]: LAYOUT_ATTRIBUTES[openAxis],
      });
    },
  );

  it("each layout wrapper's description names the axis it takes as an attribute and says its own axis is ignored", () => {
    for (const name of LAYOUT_WRAPPER_NAMES) {
      const description = STANDARD_COMPONENTS[name]?.description ?? '';
      const ownAxis = layoutWrapperAxis(name);
      if (ownAxis === undefined) {
        throw new Error(`"${name}" is not a layout-wrapper name`);
      }
      expect(description).toContain('plain markdown');
      expect(description).toContain(`:::${name}{${otherLayoutAxis(ownAxis)}=`);
      expect(description).toContain(`An \`${ownAxis}\` attribute is ignored`);
    }
  });

  it("each layout wrapper's description documents that nesting two wrappers composes", () => {
    for (const name of LAYOUT_WRAPPER_NAMES) {
      const description = STANDARD_COMPONENTS[name]?.description ?? '';
      expect(description).toContain('composes');
    }
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
