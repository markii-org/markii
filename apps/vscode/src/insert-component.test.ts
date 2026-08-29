import { describe, expect, it } from 'vitest';
import type { InsertableComponent } from '@markii/host';
import {
  insertComponentQuickPickItems,
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

describe('insertComponentQuickPickItems', () => {
  it('labels each item with the directive name', () => {
    const items = insertComponentQuickPickItems([standard('callout')]);
    expect(items).toEqual([
      { label: 'callout', description: 'standard', detail: 'A thing.' },
    ]);
  });

  it('describes a standard component as "standard"', () => {
    const items = insertComponentQuickPickItems([standard('kbd')]);
    expect(items[0]?.description).toBe('standard');
  });

  it('describes a pack component with its pack name', () => {
    const items = insertComponentQuickPickItems([fromPack('cat-card', 'cat')]);
    expect(items[0]?.description).toBe('pack "cat"');
  });

  it('preserves catalog order so the choice index maps back to the entry', () => {
    const catalog = [standard('callout'), fromPack('cat-card', 'cat')];
    const items = insertComponentQuickPickItems(catalog);
    expect(items.map((item) => item.label)).toEqual(['callout', 'cat-card']);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(insertComponentQuickPickItems([])).toEqual([]);
  });
});

describe('NO_ACTIVE_MARK_EDITOR_MESSAGE', () => {
  it('mentions Markii and a file type', () => {
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('Markii');
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('.mk.md');
  });
});
