import { describe, expect, it } from 'vitest';
import { buildComponentCatalog, completionAt } from '@markii/host';
import type { CompletionContext, CompletionItem } from '@markii/host';
import {
  completionOriginTag,
  completionQuery,
  completionSuggestions,
  filterCompletionSuggestions,
} from './complete-component.js';
import type { CompletionSuggestion } from './complete-component.js';

const catalog = buildComponentCatalog([]);

function componentItem(
  overrides: Partial<CompletionItem> = {},
): CompletionItem {
  return {
    label: 'callout',
    kind: 'component',
    detail: 'A boxed note.',
    insertText: 'callout',
    insertCursorOffset: 7,
    group: 'standard',
    ...overrides,
  };
}

describe('completionOriginTag', () => {
  it('tags a standard component with the standard origin', () => {
    expect(completionOriginTag(componentItem({ group: 'standard' }))).toBe(
      'standard',
    );
  });

  it('tags a layout wrapper with the layout origin', () => {
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
    expect(
      completionOriginTag({
        label: 'type',
        kind: 'attribute',
        detail: '',
        insertText: 'type=""',
        insertCursorOffset: 6,
      }),
    ).toBe('');
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

describe('completionSuggestions', () => {
  it('maps each item to a row, preserving order', () => {
    const context: CompletionContext = {
      kind: 'directive-name',
      replaceStart: 0,
      replaceEnd: 3,
      items: [
        componentItem({ label: 'callout' }),
        componentItem({ label: 'card', group: 'pack', packName: 'cat' }),
      ],
    };
    const rows = completionSuggestions(context);
    expect(rows.map((row) => row.label)).toEqual(['callout', 'card']);
    expect(rows[0]?.origin).toBe('standard');
    expect(rows[1]?.origin).toBe('cat');
  });

  it('carries the detail through without repeating the origin', () => {
    const context: CompletionContext = {
      kind: 'directive-name',
      replaceStart: 0,
      replaceEnd: 3,
      items: [componentItem({ detail: 'A boxed note.' })],
    };
    const [row] = completionSuggestions(context);
    expect(row?.detail).toBe('A boxed note.');
    expect(row?.detail).not.toContain(row?.origin ?? '');
  });

  it('carries the original item through', () => {
    const item = componentItem();
    const context: CompletionContext = {
      kind: 'directive-name',
      replaceStart: 0,
      replaceEnd: 3,
      items: [item],
    };
    expect(completionSuggestions(context)[0]?.item).toBe(item);
  });
});

describe('completionQuery', () => {
  it('strips a leading colon run for a directive-name context', () => {
    const line = ':::cal';
    const context: CompletionContext = {
      kind: 'directive-name',
      replaceStart: 0,
      replaceEnd: 6,
      items: [],
    };
    expect(completionQuery(line, context, line.length)).toBe('cal');
  });

  it('strips a four-colon run the same way', () => {
    const line = '::::tab';
    const context: CompletionContext = {
      kind: 'directive-name',
      replaceStart: 0,
      replaceEnd: 7,
      items: [],
    };
    expect(completionQuery(line, context, line.length)).toBe('tab');
  });

  it('leaves an attribute-name slice unchanged, no colons present', () => {
    const line = ':::callout{ty';
    const context: CompletionContext = {
      kind: 'attribute-name',
      replaceStart: 11,
      replaceEnd: 13,
      items: [],
    };
    expect(completionQuery(line, context, line.length)).toBe('ty');
  });

  it('leaves an attribute-value slice unchanged, no colons present', () => {
    const line = ':::callout{type="in';
    const context: CompletionContext = {
      kind: 'attribute-value',
      replaceStart: 17,
      replaceEnd: 20,
      items: [],
    };
    expect(completionQuery(line, context, line.length)).toBe('in');
  });

  it('matches real completionAt output for a directive-name context', () => {
    const line = ':::cal';
    const context = completionAt(line, line.length, catalog);
    expect(context.kind).toBe('directive-name');
    expect(completionQuery(line, context, line.length)).toBe('cal');
  });
});

describe('filterCompletionSuggestions', () => {
  const suggestions: readonly CompletionSuggestion[] = completionSuggestions({
    kind: 'directive-name',
    replaceStart: 0,
    replaceEnd: 3,
    items: [
      componentItem({ label: 'callout' }),
      componentItem({ label: 'card' }),
      componentItem({ label: 'cat_card', group: 'pack', packName: 'cat' }),
    ],
  });

  it('returns everything for an empty query', () => {
    expect(filterCompletionSuggestions(suggestions, '')).toHaveLength(3);
  });

  it('matches a substring of the label, case insensitively', () => {
    const filtered = filterCompletionSuggestions(suggestions, 'CARD');
    expect(filtered.map((s) => s.label)).toEqual(['card', 'cat_card']);
  });

  it('returns nothing when the query matches no label', () => {
    expect(filterCompletionSuggestions(suggestions, 'zzz')).toEqual([]);
  });

  it('does not match against the origin tag', () => {
    expect(filterCompletionSuggestions(suggestions, 'standard')).toEqual([]);
  });
});

describe('user-visible strings', () => {
  it('contain no em dash or parentheses', () => {
    const context = completionAt(':::c', 4, catalog);
    const rows = completionSuggestions(context);
    for (const row of rows) {
      expect(row.origin).not.toContain('—');
      expect(row.origin).not.toMatch(/[()]/);
      expect(row.detail).not.toContain('—');
    }
  });
});
