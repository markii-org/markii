import { describe, expect, it } from 'vitest';
import type { InsertableComponent } from '@markii/host';
import {
  filterInsertComponentSuggestions,
  insertComponentSuggestions,
  NO_ACTIVE_MARK_EDITOR_MESSAGE,
} from './insert-component.js';

function standard(directiveName: string): InsertableComponent {
  return {
    directiveName,
    kind: 'container',
    source: 'standard',
    description: 'A thing.',
    requiredAttributes: [],
  };
}

function fromPack(
  directiveName: string,
  packName: string,
): InsertableComponent {
  return {
    directiveName,
    kind: 'container',
    source: 'pack',
    packName,
    description: `From pack "${packName}".`,
    requiredAttributes: [],
  };
}

describe('insertComponentSuggestions', () => {
  it('labels each item with the directive name and carries the component through', () => {
    const suggestions = insertComponentSuggestions([standard('callout')]);
    expect(suggestions).toEqual([
      {
        label: 'callout',
        description: 'standard',
        detail: 'A thing.',
        component: standard('callout'),
      },
    ]);
  });

  it('describes a pack component with its pack name', () => {
    const suggestions = insertComponentSuggestions([
      fromPack('cat-card', 'cat'),
    ]);
    expect(suggestions[0]?.description).toBe('pack "cat"');
  });

  it('preserves catalog order', () => {
    const catalog = [standard('callout'), fromPack('cat-card', 'cat')];
    const suggestions = insertComponentSuggestions(catalog);
    expect(suggestions.map((s) => s.label)).toEqual(['callout', 'cat-card']);
  });
});

describe('filterInsertComponentSuggestions', () => {
  const suggestions = insertComponentSuggestions([
    standard('callout'),
    standard('card'),
    fromPack('cat-card', 'cat'),
  ]);

  it('returns everything for an empty query', () => {
    expect(filterInsertComponentSuggestions(suggestions, '')).toHaveLength(3);
  });

  it('matches a substring of the directive name, case-insensitively', () => {
    const filtered = filterInsertComponentSuggestions(suggestions, 'CARD');
    expect(filtered.map((s) => s.label)).toEqual(['card', 'cat-card']);
  });

  it('returns nothing when the query matches no directive name', () => {
    expect(filterInsertComponentSuggestions(suggestions, 'zzz')).toEqual([]);
  });
});

describe('NO_ACTIVE_MARK_EDITOR_MESSAGE', () => {
  it('mentions Markii', () => {
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('Markii');
  });
});
