import { describe, expect, it } from 'vitest';
import type { InsertableComponent } from '@markii/host';
import {
  insertComponentQuickPickItems,
  INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER,
  INSERT_COMPONENT_QUICK_PICK_TITLE,
  LAYOUT_SECTION_LABEL,
  NO_ACTIVE_MARK_EDITOR_MESSAGE,
  packSectionLabel,
  STANDARD_SECTION_LABEL,
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

describe('insertComponentQuickPickItems', () => {
  it('emits a Standard separator before standard components', () => {
    const items = insertComponentQuickPickItems([standard('callout')]);
    expect(items[0]).toEqual({
      kind: 'separator',
      label: STANDARD_SECTION_LABEL,
    });
    expect(items[1]).toEqual({
      kind: 'component',
      label: 'callout',
      detail: 'A thing.',
      catalogIndex: 0,
    });
  });

  it('emits sections in order: Standard, Layout, then one per pack', () => {
    const catalog = [
      standard('callout'),
      layout('center'),
      fromPack('cat_card', 'cat', 'A cat profile card.'),
    ];
    const items = insertComponentQuickPickItems(catalog);
    const separators = items.filter((item) => item.kind === 'separator');
    expect(separators.map((s) => s.label)).toEqual([
      STANDARD_SECTION_LABEL,
      LAYOUT_SECTION_LABEL,
      packSectionLabel('cat'),
    ]);
  });

  it('emits a separator per pack, only when that pack has entries', () => {
    const catalog = [
      fromPack('cat_card', 'cat', 'A cat profile card.'),
      fromPack('dog_card', 'dog'),
    ];
    const items = insertComponentQuickPickItems(catalog);
    expect(
      items.filter((item) => item.kind === 'separator').map((s) => s.label),
    ).toEqual([packSectionLabel('cat'), packSectionLabel('dog')]);
  });

  it('emits no separator for an empty catalog', () => {
    expect(insertComponentQuickPickItems([])).toEqual([]);
  });

  it('emits no Layout separator when the catalog has no layout components', () => {
    const items = insertComponentQuickPickItems([
      standard('callout'),
      fromPack('cat_card', 'cat'),
    ]);
    const separators = items.filter((item) => item.kind === 'separator');
    expect(separators.map((s) => s.label)).toEqual([
      STANDARD_SECTION_LABEL,
      packSectionLabel('cat'),
    ]);
  });

  it('details a standard component with the catalog description', () => {
    const items = insertComponentQuickPickItems([standard('kbd', 'A key.')]);
    const row = items.find((item) => item.kind === 'component');
    expect(row).toMatchObject({ label: 'kbd', detail: 'A key.' });
  });

  it('falls back to an empty detail when a standard component has no description', () => {
    const component = standard('kbd');
    const withoutDescription: InsertableComponent = {
      ...component,
      description: undefined,
    };
    const items = insertComponentQuickPickItems([withoutDescription]);
    const row = items.find((item) => item.kind === 'component');
    expect(row).toMatchObject({ detail: '' });
  });

  it('details a pack component with its section label and description', () => {
    const items = insertComponentQuickPickItems([
      fromPack('cat_card', 'cat', 'A cat profile card.'),
    ]);
    const row = items.find((item) => item.kind === 'component');
    expect(row).toMatchObject({ detail: 'cat pack - A cat profile card.' });
  });

  it('falls back to the section label alone when a pack declares no description', () => {
    const items = insertComponentQuickPickItems([fromPack('cat_card', 'cat')]);
    const row = items.find((item) => item.kind === 'component');
    expect(row).toMatchObject({ detail: 'cat pack' });
  });

  it('carries catalogIndex back to the right catalog entry across sections', () => {
    const catalog = [
      standard('callout'),
      layout('center'),
      fromPack('cat_card', 'cat'),
    ];
    const items = insertComponentQuickPickItems(catalog);
    const rows = items.filter((item) => item.kind === 'component');
    expect(rows.map((row) => row.catalogIndex)).toEqual([0, 1, 2]);
    for (const row of rows) {
      expect(catalog[row.catalogIndex]?.directiveName).toBe(row.label);
    }
  });

  it('keeps component row labels as the exact directive name', () => {
    const items = insertComponentQuickPickItems([fromPack('cat_card', 'cat')]);
    const row = items.find((item) => item.kind === 'component');
    expect(row).toMatchObject({ label: 'cat_card' });
  });
});

describe('user-visible strings', () => {
  const allStrings = [
    NO_ACTIVE_MARK_EDITOR_MESSAGE,
    INSERT_COMPONENT_QUICK_PICK_TITLE,
    INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER,
    STANDARD_SECTION_LABEL,
    LAYOUT_SECTION_LABEL,
    packSectionLabel('cat'),
    ...insertComponentQuickPickItems([
      standard('callout'),
      layout('center'),
      fromPack('cat_card', 'cat', 'A cat profile card.'),
      fromPack('dog_card', 'dog'),
    ]).map((entry) =>
      entry.kind === 'separator' ? entry.label : entry.detail,
    ),
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
  it('mentions Markii and a file type', () => {
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('Markii');
    expect(NO_ACTIVE_MARK_EDITOR_MESSAGE).toContain('.mk.md');
  });
});
