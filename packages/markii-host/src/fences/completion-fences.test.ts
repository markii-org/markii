import { describe, expect, it } from 'vitest';
import { completionAt } from '../complete/index.js';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import { componentSkeleton } from '../insert/component-skeleton.js';
import { fenceExtensionEdits } from './container-fences.js';

/**
 * Ties the two seams a host actually pairs at runtime: the text
 * `completionAt` (or `componentSkeleton`) says to insert, and the fence
 * edits that must accompany it. Each side is unit-tested on its own, but
 * only together do they prove that what a host inserts is recognized as a
 * container by the fence scanner.
 */
const catalog = buildComponentCatalog([]);

describe('accepting a completion inside a container', () => {
  it('lengthens the enclosing pair for a container item', () => {
    const lines = [':::card{}', ':::ta', ':::'];
    const context = completionAt(lines[1] ?? '', 5, catalog);
    const item = context.items.find((entry) => entry.label === 'tabs');
    expect(item?.insertText).toBe(':::tabs{}\n\n:::');

    expect(
      fenceExtensionEdits(lines.join('\n'), 1, item?.insertText ?? ''),
    ).toEqual([
      { line: 0, column: 0, oldText: ':::', newText: '::::' },
      { line: 2, column: 0, oldText: ':::', newText: '::::' },
    ]);
  });

  it('leaves the enclosing pair alone for a leaf item', () => {
    const lines = [':::card{}', '::div', ':::'];
    const context = completionAt(lines[1] ?? '', 5, catalog);
    const item = context.items.find((entry) => entry.label === 'divider');
    expect(item?.insertText).toBe('::divider{}');

    expect(
      fenceExtensionEdits(lines.join('\n'), 1, item?.insertText ?? ''),
    ).toEqual([]);
  });

  it('measures against the longer run an author typed for themselves', () => {
    const lines = ['::::card{}', '::::ta', '::::'];
    const context = completionAt(lines[1] ?? '', 6, catalog);
    const item = context.items.find((entry) => entry.label === 'tabs');
    expect(item?.insertText).toBe('::::tabs{}\n\n::::');

    expect(
      fenceExtensionEdits(lines.join('\n'), 1, item?.insertText ?? ''),
    ).toEqual([
      { line: 0, column: 0, oldText: '::::', newText: ':::::' },
      { line: 2, column: 0, oldText: '::::', newText: ':::::' },
    ]);
  });

  it('lengthens the enclosing pair for the Insert Component skeleton too', () => {
    const skeleton = componentSkeleton('tabs', 'container', []);
    const lines = [':::card{}', '', ':::'];
    expect(fenceExtensionEdits(lines.join('\n'), 1, skeleton.text)).toEqual([
      { line: 0, column: 0, oldText: ':::', newText: '::::' },
      { line: 2, column: 0, oldText: ':::', newText: '::::' },
    ]);
  });
});
