import { describe, expect, it } from 'vitest';
import {
  buildNoteCatalog,
  invalidEnumAttribute,
  standardNoteCatalog,
  validateNote,
  type NoteCatalogEntry,
  type NoteTreeNode,
} from './validate-note';

const range = (line: number, c1: number, c2: number) => ({
  start: { line, column: c1 },
  end: { line, column: c2 },
});

function directive(
  type: string,
  name: string,
  attributes: Record<string, string | null> = {},
  line = 1,
  children: NoteTreeNode[] = [],
): NoteTreeNode {
  return { type, name, attributes, children, position: range(line, 1, 10) };
}

const root = (...children: NoteTreeNode[]): NoteTreeNode => ({
  type: 'root',
  children,
});

describe('validateNote', () => {
  const catalog = standardNoteCatalog();

  it('reports nothing for a clean note', () => {
    const tree = root(
      directive('containerDirective', 'callout', { type: 'warning' }),
      directive('textDirective', 'kbd'),
      directive('textDirective', 'value'),
    );
    expect(validateNote(tree, catalog)).toEqual([]);
  });

  it('reports an unknown directive with its range and wording', () => {
    const events = validateNote(
      root(directive('leafDirective', 'nothing', {}, 3)),
      catalog,
    );
    expect(events).toEqual([
      {
        kind: 'unknown-directive',
        directive: 'nothing',
        message: 'nothing: unknown component, shown as a placeholder',
        position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 },
      },
    ]);
  });

  it('reports a block component written inline', () => {
    const [event] = validateNote(
      root(directive('textDirective', 'callout')),
      catalog,
    );
    expect(event?.kind).toBe('form-mismatch');
    expect(event?.message).toBe(
      'callout: block component was written inline and was not rendered',
    );
  });

  it('does not report an inline component written as a block', () => {
    expect(
      validateNote(root(directive('leafDirective', 'kbd')), catalog),
    ).toEqual([]);
  });

  it('reports a value outside a standard enum, nested in a body', () => {
    const tree = root(
      directive('containerDirective', 'callout', {}, 1, [
        directive('leafDirective', 'card', { text: 'Hey' }, 2),
      ]),
    );
    const [event] = validateNote(tree, catalog);
    expect(event).toMatchObject({
      kind: 'invalid-attribute-value',
      directive: 'card',
      attribute: 'text',
      message: 'card: "Hey" is not a valid text value (ignored)',
    });
  });

  it('ignores the reserved layout keys and bare or empty values', () => {
    const tree = root(
      directive('containerDirective', 'card', {
        width: 'bogus',
        align: 'bogus',
        text: null,
      }),
    );
    expect(validateNote(tree, catalog)).toEqual([]);
  });

  it('uses a pack entry for the name, the form and the enum', () => {
    const pack: NoteCatalogEntry = {
      directiveName: 'ana_meter',
      kind: 'leaf',
      kindDeclared: true,
      attributes: [{ name: 'unit', values: ['kg', 'lb'] }],
    };
    const full = buildNoteCatalog([pack]);
    const events = validateNote(
      root(
        directive('leafDirective', 'ana_meter', { unit: 'stone' }),
        directive('textDirective', 'ana_meter'),
      ),
      full,
    );
    expect(events.map((e) => e.kind)).toEqual([
      'invalid-attribute-value',
      'form-mismatch',
    ]);
  });

  it('skips the form check for a pack kind that was only a default', () => {
    const pack: NoteCatalogEntry = {
      directiveName: 'ana_note',
      kind: 'container',
      kindDeclared: false,
    };
    expect(
      validateNote(
        root(directive('textDirective', 'ana_note')),
        buildNoteCatalog([pack]),
      ),
    ).toEqual([]);
  });

  it('lets the standard set keep a name a pack also claims', () => {
    const clash: NoteCatalogEntry = {
      directiveName: 'callout',
      kind: 'inline',
      kindDeclared: true,
    };
    const full = buildNoteCatalog([clash]);
    expect(full.filter((e) => e.directiveName === 'callout')).toHaveLength(1);
  });

  it('never throws on a malformed tree', () => {
    const odd = {
      type: 'root',
      children: [null, 3, { type: 'textDirective' }],
    };
    expect(() =>
      validateNote(odd as unknown as NoteTreeNode, catalog),
    ).not.toThrow();
  });

  it('answers a directive named after an object prototype member as unknown', () => {
    const [event] = validateNote(
      root(directive('leafDirective', 'constructor')),
      catalog,
    );
    expect(event?.kind).toBe('unknown-directive');
  });
});

describe('invalidEnumAttribute', () => {
  it('finds the first offending standard attribute', () => {
    expect(invalidEnumAttribute('card', { text: 'Hey' })).toEqual({
      attribute: 'text',
      value: 'Hey',
    });
    expect(invalidEnumAttribute('card', { text: 'left' })).toBeUndefined();
    expect(invalidEnumAttribute('ana_x', { text: 'Hey' })).toBeUndefined();
  });
});
