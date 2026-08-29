import { describe, expect, it } from 'vitest';
import type { InsertableComponent } from '@markii/host';
import {
  filterInsertComponentSuggestions,
  insertComponentSuggestions,
  LAYOUT_ORIGIN,
  NO_ACTIVE_MARK_EDITOR_MESSAGE,
  NO_MATCHING_COMPONENTS_MESSAGE,
  STANDARD_ORIGIN,
} from './insert-component.js';

function standard(
  directiveName: string,
  description?: string,
): InsertableComponent {
  return {
    directiveName,
    kind: 'container',
    source: 'standard',
    group: 'standard',
    description: description ?? 'A thing.',
    requiredAttributes: [],
  };
}

function layout(directiveName: string): InsertableComponent {
  return {
    directiveName,
    kind: 'container',
    source: 'standard',
    group: 'layout',
    description: 'A layout wrapper.',
    requiredAttributes: [],
  };
}

function fromPack(
  directiveName: string,
  packName: string,
  description?: string,
): InsertableComponent {
  return {
    directiveName,
    kind: 'container',
    source: 'pack',
    group: 'pack',
    packName,
    description,
    requiredAttributes: [],
  };
}

describe('insertComponentSuggestions', () => {
  it('labels each item with the directive name and carries the component through', () => {
    const suggestions = insertComponentSuggestions([standard('callout')]);
    expect(suggestions).toEqual([
      {
        label: 'callout',
        origin: STANDARD_ORIGIN,
        detail: 'A thing.',
        component: standard('callout'),
      },
    ]);
  });

  it('tags a standard component with the standard origin', () => {
    const suggestions = insertComponentSuggestions([standard('kbd')]);
    expect(suggestions[0]?.origin).toBe('standard');
  });

  it('tags a layout wrapper with the layout origin', () => {
    const suggestions = insertComponentSuggestions([layout('center')]);
    expect(suggestions[0]?.origin).toBe(LAYOUT_ORIGIN);
  });

  it('tags a pack component with the pack name, not a generic label', () => {
    const suggestions = insertComponentSuggestions([
      fromPack('cat_card', 'cat', 'A cat profile card.'),
    ]);
    expect(suggestions[0]?.origin).toBe('cat');
  });

  it('does not repeat the origin inside the detail', () => {
    const suggestions = insertComponentSuggestions([
      fromPack('cat_card', 'cat', 'A profile card.'),
    ]);
    expect(suggestions[0]?.detail).toBe('A profile card.');
    expect(suggestions[0]?.detail).not.toContain(suggestions[0]?.origin ?? '');
  });

  it('gives an empty detail for a pack component with no declared description', () => {
    const suggestions = insertComponentSuggestions([
      fromPack('cat_card', 'cat'),
    ]);
    expect(suggestions[0]?.detail).toBe('');
  });

  it('preserves catalog order', () => {
    const catalog = [standard('callout'), fromPack('cat_card', 'cat')];
    const suggestions = insertComponentSuggestions(catalog);
    expect(suggestions.map((s) => s.label)).toEqual(['callout', 'cat_card']);
  });
});

describe('filterInsertComponentSuggestions', () => {
  const suggestions = insertComponentSuggestions([
    standard('callout'),
    standard('card'),
    fromPack('cat_card', 'cat'),
  ]);

  it('returns everything for an empty query', () => {
    expect(filterInsertComponentSuggestions(suggestions, '')).toHaveLength(3);
  });

  it('matches a substring of the directive name, case-insensitively', () => {
    const filtered = filterInsertComponentSuggestions(suggestions, 'CARD');
    expect(filtered.map((s) => s.label)).toEqual(['card', 'cat_card']);
  });

  it('returns nothing when the query matches no directive name', () => {
    expect(filterInsertComponentSuggestions(suggestions, 'zzz')).toEqual([]);
  });

  it('does not match against the origin tag', () => {
    const filtered = filterInsertComponentSuggestions(suggestions, 'standard');
    expect(filtered).toEqual([]);
  });
});

describe('user-visible strings', () => {
  const allStrings = [
    NO_ACTIVE_MARK_EDITOR_MESSAGE,
    NO_MATCHING_COMPONENTS_MESSAGE,
    STANDARD_ORIGIN,
    LAYOUT_ORIGIN,
    ...insertComponentSuggestions([
      standard('callout'),
      layout('center'),
      fromPack('cat_card', 'cat', 'A cat profile card.'),
      fromPack('dog_card', 'dog'),
    ]).flatMap((suggestion) => [suggestion.origin, suggestion.detail]),
  ];

  it('contains no em dash', () => {
    for (const value of allStrings) {
      expect(value).not.toContain('—');
    }
  });

  it('contains no parentheses', () => {
    for (const value of allStrings) {
      expect(value).not.toMatch(/[()]/);
    }
  });
});

describe('NO_ACTIVE_MARK_EDITOR_MESSAGE', () => {
  it('mentions Markii', () => {
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('Markii');
  });
});
