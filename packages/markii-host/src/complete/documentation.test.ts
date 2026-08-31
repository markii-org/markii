import { describe, expect, it } from 'vitest';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import type { InsertableComponent } from '../insert/component-catalog.js';
import {
  componentDocumentation,
  formatComponentDocumentation,
} from './documentation.js';

function standardEntry(name: string): InsertableComponent {
  const entry = buildComponentCatalog([]).find((c) => c.directiveName === name);
  if (entry === undefined) throw new Error(`no standard component "${name}"`);
  return entry;
}

function packEntry(
  overrides: Partial<InsertableComponent> = {},
): InsertableComponent {
  return {
    directiveName: 'cat_card',
    kind: 'container',
    source: 'pack',
    group: 'pack',
    packName: 'cat',
    requiredAttributes: [],
    kindDeclared: false,
    ...overrides,
  };
}

describe('componentDocumentation — standard components', () => {
  it('carries the full (untruncated) contract description as summary', () => {
    const doc = componentDocumentation(standardEntry('callout'));
    expect(doc.summary).toBe(STANDARD_COMPONENTS.callout!.description);
  });

  it('lists every contract attribute, marking required and enum', () => {
    const doc = componentDocumentation(standardEntry('callout'));
    expect(doc.attributes).toContain('type: info | warning | danger');
    expect(doc.attributes).toContain('title');
  });

  it('marks a required attribute with "(required)"', () => {
    const doc = componentDocumentation(standardEntry('figure'));
    expect(doc.attributes).toContain('src (required)');
  });

  it('builds a leaf/inline example from the skeleton as-is', () => {
    const doc = componentDocumentation(standardEntry('kbd'));
    expect(doc.example).toBe(':kbd[]');
  });

  it('builds a container example as just the opening fence line', () => {
    const doc = componentDocumentation(standardEntry('callout'));
    expect(doc.example).toBe(':::callout{}');
    expect(doc.example).not.toContain('\n');
  });

  it('a component with a required attribute shows it in the example fence', () => {
    const doc = componentDocumentation(standardEntry('figure'));
    expect(doc.example).toBe(':::figure{src=""}');
  });
});

describe('componentDocumentation — pack components', () => {
  it('uses the declared description verbatim, with no composed filler', () => {
    const doc = componentDocumentation(
      packEntry({ description: 'A cat profile card.' }),
    );
    expect(doc.summary).toBe('A cat profile card.');
  });

  it('has an empty summary when the pack declares no description', () => {
    const doc = componentDocumentation(packEntry());
    expect(doc.summary).toBe('');
  });

  it('always has an empty attributes array (pack manifests carry no attribute metadata)', () => {
    const doc = componentDocumentation(packEntry());
    expect(doc.attributes).toEqual([]);
  });

  it('builds an example from the pack component kind and directive name', () => {
    const doc = componentDocumentation(packEntry({ kind: 'leaf' }));
    expect(doc.example).toBe('::cat_card{}');
  });
});

describe('formatComponentDocumentation', () => {
  it('formats all three sections with correct spacing', () => {
    const text = formatComponentDocumentation({
      summary: 'A colored box for an aside.',
      attributes: ['type: info | warning | danger', 'title'],
      example: ':::callout{}',
    });
    expect(text).toBe(
      'A colored box for an aside.\n\nAttributes:\n- type: info | warning | danger\n- title\n\nExample: :::callout{}',
    );
  });

  it('omits the attributes section entirely when there are none', () => {
    const text = formatComponentDocumentation({
      summary: 'A short summary.',
      attributes: [],
      example: ':kbd[]',
    });
    expect(text).toBe('A short summary.\n\nExample: :kbd[]');
  });

  it('omits the example section entirely when there is none', () => {
    const text = formatComponentDocumentation({
      summary: 'A short summary.',
      attributes: [],
      example: '',
    });
    expect(text).toBe('A short summary.');
  });

  it('formats an attribute-only documentation object (no attributes list, no example)', () => {
    const text = formatComponentDocumentation({
      summary: 'Sets the callout style.',
      attributes: [],
      example: '',
    });
    expect(text).toBe('Sets the callout style.');
  });

  it('formats to the empty string when everything is empty', () => {
    const text = formatComponentDocumentation({
      summary: '',
      attributes: [],
      example: '',
    });
    expect(text).toBe('');
  });

  it('never produces a trailing blank line', () => {
    const text = formatComponentDocumentation({
      summary: 'x',
      attributes: ['a'],
      example: 'y',
    });
    expect(text.endsWith('\n')).toBe(false);
  });
});

describe('componentDocumentation: declared pack attributes (issue #27 slice 4)', () => {
  it('renders one line per declared attribute', () => {
    const doc = componentDocumentation(
      packEntry({
        description: 'A dated timeline.',
        requiredAttributes: ['from'],
        attributes: [
          { name: 'from', description: 'First date.', required: true },
          { name: 'scale', values: ['days', 'weeks'], default: 'days' },
          { name: 'label' },
        ],
      }),
    );
    expect(doc.summary).toBe('A dated timeline.');
    expect(doc.attributes).toEqual([
      'from (required)',
      'scale: days | weeks (default: days)',
      'label',
    ]);
    expect(doc.example).toBe(':::cat_card{from=""}');
  });

  it('shows a declared default with no values', () => {
    const doc = componentDocumentation(
      packEntry({ attributes: [{ name: 'scale', default: 'days' }] }),
    );
    expect(doc.attributes).toEqual(['scale (default: days)']);
  });

  it('keeps the attribute list empty for a pack that declares none', () => {
    expect(componentDocumentation(packEntry()).attributes).toEqual([]);
  });

  it('formats a pack component with attributes as plain text', () => {
    const text = formatComponentDocumentation(
      componentDocumentation(
        packEntry({
          description: 'A dated timeline.',
          attributes: [{ name: 'scale', values: ['days', 'weeks'] }],
        }),
      ),
    );
    expect(text).toBe(
      [
        'A dated timeline.',
        '',
        'Attributes:',
        '- scale: days | weeks',
        '',
        'Example: :::cat_card{}',
      ].join('\n'),
    );
  });
});
