import { describe, expect, it } from 'vitest';
import { buildComponentCatalog, completionAt, hoverAt } from '@markii/host';
import type {
  CompletionItem,
  ComponentDocumentation,
  DiscoveredPack,
} from '@markii/host';
import {
  MARKII_COMPLETION_TRIGGER_CHARACTERS,
  completionFilterText,
  completionItemDetail,
  completionMarkdown,
  completionOriginTag,
  completionSortText,
  snippetText,
} from './completion.js';

function componentItem(
  overrides: Partial<CompletionItem> = {},
): CompletionItem {
  return {
    label: 'callout',
    kind: 'component',
    detail: 'A colored box for an aside, warning, or danger note.',
    insertText: ':::callout{}',
    insertCursorOffset: 10,
    group: 'standard',
    ...overrides,
  };
}

function attributeItem(
  overrides: Partial<CompletionItem> = {},
): CompletionItem {
  return {
    label: 'type',
    kind: 'attribute',
    detail: 'required. info, warning, or danger.',
    insertText: 'type=""',
    insertCursorOffset: 6,
    ...overrides,
  };
}

describe('MARKII_COMPLETION_TRIGGER_CHARACTERS', () => {
  it('contains the five directive-authoring trigger characters', () => {
    expect(MARKII_COMPLETION_TRIGGER_CHARACTERS).toEqual([
      ':',
      '{',
      '=',
      '"',
      ' ',
    ]);
  });
});

describe('completionOriginTag', () => {
  it('tags a standard component', () => {
    expect(completionOriginTag(componentItem({ group: 'standard' }))).toBe(
      'standard',
    );
  });

  it('tags a layout component', () => {
    expect(completionOriginTag(componentItem({ group: 'layout' }))).toBe(
      'layout',
    );
  });

  it('tags a pack component with the pack name', () => {
    expect(
      completionOriginTag(componentItem({ group: 'pack', packName: 'cat' })),
    ).toBe('cat');
  });

  it('is empty for an attribute item', () => {
    expect(completionOriginTag(attributeItem())).toBe('');
  });

  it('is empty for a value item', () => {
    expect(
      completionOriginTag({
        label: 'info',
        kind: 'value',
        detail: '',
        insertText: 'info',
        insertCursorOffset: 4,
      }),
    ).toBe('');
  });
});

describe('completionItemDetail', () => {
  it('shows the origin tag only for a component, never its description', () => {
    expect(completionItemDetail(componentItem())).toBe('standard');
  });

  it('shows the origin tag when a component has no detail', () => {
    expect(completionItemDetail(componentItem({ detail: '' }))).toBe(
      'standard',
    );
  });

  it('uses the pack name as the tag for a pack component', () => {
    expect(
      completionItemDetail(
        componentItem({
          group: 'pack',
          packName: 'cat',
          detail: 'A cat profile card.',
        }),
      ),
    ).toBe('cat');
  });

  it('passes an attribute item detail through unchanged', () => {
    expect(completionItemDetail(attributeItem())).toBe(
      'required. info, warning, or danger.',
    );
  });

  it('passes a value item detail through unchanged, including empty', () => {
    expect(
      completionItemDetail({
        label: 'info',
        kind: 'value',
        detail: '',
        insertText: 'info',
        insertCursorOffset: 4,
      }),
    ).toBe('');
  });
});

describe('completionMarkdown', () => {
  it('renders summary, attributes, and example as markdown', () => {
    const doc: ComponentDocumentation = {
      summary: 'A colored box for an aside, warning, or danger note.',
      attributes: ['type (required): info | warning | danger', 'title'],
      example: ':::callout{}',
    };
    expect(completionMarkdown(doc)).toBe(
      [
        'A colored box for an aside, warning, or danger note.',
        '**Attributes**\n- type (required): info | warning | danger\n- title',
        '```markii\n:::callout{}\n```',
      ].join('\n\n'),
    );
  });

  it('omits an empty attributes section', () => {
    const doc: ComponentDocumentation = {
      summary: 'A key on a keyboard.',
      attributes: [],
      example: ':kbd[Ctrl]',
    };
    expect(completionMarkdown(doc)).toBe(
      'A key on a keyboard.\n\n```markii\n:kbd[Ctrl]\n```',
    );
  });

  it('omits an empty example section', () => {
    const doc: ComponentDocumentation = {
      summary: 'Required attribute.',
      attributes: [],
      example: '',
    };
    expect(completionMarkdown(doc)).toBe('Required attribute.');
  });

  it('never ends with a trailing blank line', () => {
    const doc: ComponentDocumentation = {
      summary: 'A summary.',
      attributes: ['name'],
      example: '',
    };
    const rendered = completionMarkdown(doc);
    expect(rendered.endsWith('\n')).toBe(false);
  });

  it('renders the empty string for all-empty documentation', () => {
    expect(
      completionMarkdown({ summary: '', attributes: [], example: '' }),
    ).toBe('');
  });
});

describe('snippetText', () => {
  it('splices $0 at the cursor offset in plain text', () => {
    expect(snippetText('callout', 7)).toBe('callout$0');
  });

  it('splices $0 in the middle of plain text', () => {
    expect(snippetText('type=""', 6)).toBe('type="$0"');
  });

  it('escapes a backslash, dollar, and closing brace before the cursor', () => {
    // Cursor sits right after the escaped characters.
    const insertText = '\\$}rest';
    const result = snippetText(insertText, 3);
    expect(result).toBe('\\\\\\$\\}$0rest');
  });

  it('escapes a backslash, dollar, and closing brace after the cursor', () => {
    const insertText = 'pre\\$}';
    const result = snippetText(insertText, 3);
    expect(result).toBe('pre$0\\\\\\$\\}');
  });

  it('places $0 correctly when special characters straddle the cursor', () => {
    // "a$b}c" with cursor after the '$' (offset 2): "a$" | "b}c"
    const result = snippetText('a$b}c', 2);
    expect(result).toBe('a\\$$0b\\}c');
  });

  it('clamps an out-of-range cursor offset to the end of the text', () => {
    expect(snippetText('abc', 100)).toBe('abc$0');
    expect(snippetText('abc', -5)).toBe('$0abc');
  });

  it('handles an empty insert text', () => {
    expect(snippetText('', 0)).toBe('$0');
  });
});

describe('completionSortText', () => {
  it('zero-pads to a fixed width', () => {
    expect(completionSortText(0)).toBe('000000');
    expect(completionSortText(7)).toBe('000007');
    expect(completionSortText(42)).toBe('000042');
  });

  it('preserves catalog order when sorted lexicographically', () => {
    const keys = [0, 1, 2, 10, 20, 100].map(completionSortText);
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
  });
});

describe('completionFilterText', () => {
  it('prefixes the label with the colon run the replace range starts on', () => {
    // A directive-name context replaces from column 0, so VS Code scores
    // the row against ":::cal" and would reject a bare "callout".
    expect(completionFilterText(':::cal', 0, 'callout')).toBe(':::callout');
    expect(completionFilterText('::sta', 0, 'stat')).toBe('::stat');
    expect(completionFilterText(':kb', 0, 'kbd')).toBe(':kbd');
  });

  it('keeps a leading-whitespace block opener aligned with the typed text', () => {
    expect(completionFilterText('  :::cal', 2, 'callout')).toBe(':::callout');
  });

  it('returns the label unchanged when the range starts on a name', () => {
    // The trailing-content case: the range covers the bare name only.
    expect(completionFilterText(':::cal{type=info}', 3, 'callout')).toBe(
      'callout',
    );
  });

  it('returns the label unchanged for an attribute name or value range', () => {
    expect(completionFilterText(':::callout{ty', 11, 'type')).toBe('type');
    expect(completionFilterText(':::callout{type="in', 17, 'info')).toBe(
      'info',
    );
  });

  it('returns the label unchanged for an out-of-range start', () => {
    expect(completionFilterText(':::cal', 99, 'callout')).toBe('callout');
  });
});

/**
 * End to end over the pure modules for a PACK component's declared
 * attributes (issue #27 slice 4): `@markii/host` decides what completes,
 * this extension's wording module decides how it reads. No `vscode` here,
 * so the assertions are on exactly what `extension.ts` maps onto
 * `vscode.CompletionItem`.
 */
describe('pack attribute metadata reaches the VS Code rows', () => {
  const pack: DiscoveredPack = {
    folder: '/packs/ana',
    manifest: {
      name: 'ana',
      engine: 'react',
      components: {
        timeline: {
          source: './Timeline.tsx',
          kind: 'container',
          description: 'A dated timeline.',
          attributes: [
            { name: 'from', description: 'First date shown.', required: true },
            { name: 'scale', values: ['days', 'weeks'], default: 'days' },
          ],
        },
      },
    },
    componentPaths: { timeline: '/packs/ana/Timeline.tsx' },
    scriptsDir: '/packs/ana/scripts',
    scriptPath: '/packs/ana/webview.js',
  };
  const catalog = buildComponentCatalog([pack]);

  it('offers a declared attribute name with its own detail, not an origin tag', () => {
    const line = ':::ana_timeline{';
    const ctx = completionAt(line, line.length, catalog);
    const from = ctx.items.find((item) => item.label === 'from');
    expect(from).toBeDefined();
    expect(completionItemDetail(from!)).toBe('required. First date shown.');
    expect(completionOriginTag(from!)).toBe('');
    expect(snippetText(from!.insertText, from!.insertCursorOffset)).toBe(
      'from="$0"',
    );
  });

  it('offers declared enum values', () => {
    const line = ':::ana_timeline{scale="';
    const ctx = completionAt(line, line.length, catalog);
    expect(ctx.items.map((item) => item.label)).toEqual(['days', 'weeks']);
  });

  it('keeps the component row detail to the origin tag only', () => {
    const ctx = completionAt(':::ana_time', 11, catalog);
    const item = ctx.items.find((i) => i.label === 'ana_timeline');
    expect(completionItemDetail(item!)).toBe('ana');
  });

  it('renders the declared attributes into hover markdown', () => {
    const hover = hoverAt(':::ana_timeline{}', 6, catalog);
    expect(completionMarkdown(hover!.documentation)).toBe(
      [
        'A dated timeline.',
        '',
        '**Attributes**',
        '- from (required)',
        '- scale: days | weeks (default: days)',
        '',
        '```markii',
        ':::ana_timeline{from=""}',
        '```',
      ].join('\n'),
    );
  });
});
