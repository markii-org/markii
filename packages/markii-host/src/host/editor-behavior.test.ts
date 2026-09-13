import { describe, expect, it, vi } from 'vitest';
import type {
  CompletionItem,
  InsertableComponent,
} from '@markii/stdlib/editor';
import {
  completeAtViaEditor,
  completionOriginTag,
  createCatalogCache,
  hoverAtViaEditor,
  hoverDocumentationText,
  insertComponentPlan,
} from './editor-behavior.js';
import type { HostEditor } from './adapter.js';

function calloutCatalog(): InsertableComponent[] {
  return [
    {
      directiveName: 'callout',
      kind: 'container',
      source: 'standard',
      group: 'standard',
      requiredAttributes: [],
      kindDeclared: true,
    },
    {
      directiveName: 'center',
      kind: 'container',
      source: 'standard',
      group: 'layout',
      requiredAttributes: [],
      kindDeclared: true,
    },
    {
      directiveName: 'cat_card',
      kind: 'container',
      source: 'pack',
      group: 'pack',
      packName: 'cat',
      requiredAttributes: [],
      kindDeclared: true,
    },
  ];
}

function fakeEditor(text: string, line: number, column: number): HostEditor {
  return {
    documentText: () => text,
    documentPath: () => '/note.mk.md',
    cursor: () => ({ line, column }),
    applyEdits: async () => true,
  };
}

function completionItem(
  overrides: Partial<CompletionItem> = {},
): CompletionItem {
  return {
    kind: 'component',
    label: 'callout',
    detail: '',
    insertText: '',
    insertCursorOffset: 0,
    ...overrides,
  };
}

describe('completionOriginTag', () => {
  it('tags a standard component "standard"', () => {
    expect(completionOriginTag(completionItem({ group: 'standard' }))).toBe(
      'standard',
    );
  });

  it('tags a layout component "layout"', () => {
    expect(completionOriginTag(completionItem({ group: 'layout' }))).toBe(
      'layout',
    );
  });

  it('tags a pack component with its pack name', () => {
    expect(
      completionOriginTag(completionItem({ group: 'pack', packName: 'cat' })),
    ).toBe('cat');
  });

  it('is empty for a non-component item', () => {
    expect(completionOriginTag(completionItem({ kind: 'attribute' }))).toBe('');
  });
});

describe('createCatalogCache', () => {
  it('builds once and caches across repeated get() calls', async () => {
    const build = vi.fn(async () => calloutCatalog());
    const cache = createCatalogCache(build);
    await cache.get();
    await cache.get();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight build across concurrent get() calls', async () => {
    let resolveBuild: (() => void) | undefined;
    const build = vi.fn(
      () =>
        new Promise<readonly InsertableComponent[]>((resolve) => {
          resolveBuild = () => resolve(calloutCatalog());
        }),
    );
    const cache = createCatalogCache(build);
    const first = cache.get();
    const second = cache.get();
    resolveBuild?.();
    await Promise.all([first, second]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after invalidate()', async () => {
    const build = vi.fn(async () => calloutCatalog());
    const cache = createCatalogCache(build);
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('degrades to an empty catalog when build rejects, never throws', async () => {
    const cache = createCatalogCache(async () => {
      throw new Error('disk error');
    });
    await expect(cache.get()).resolves.toEqual([]);
  });
});

describe('completeAtViaEditor / hoverAtViaEditor', () => {
  it('completes a directive name at the given position, ignoring the editor cursor', () => {
    // The editor's own cursor is elsewhere; the position argument is what
    // is used, matching how a real completion provider is invoked with an
    // explicit position rather than the live caret.
    const editor = fakeEditor(':::cal', 5, 5);
    const ctx = completeAtViaEditor(
      editor,
      { line: 0, column: 6 },
      calloutCatalog(),
    );
    expect(ctx.kind).toBe('directive-name');
  });

  it('hovers a known directive name at the given position', () => {
    const editor = fakeEditor(':::callout', 9, 9);
    const hover = hoverAtViaEditor(
      editor,
      { line: 0, column: 5 },
      calloutCatalog(),
    );
    expect(hover?.directiveName).toBe('callout');
  });

  it('returns undefined hover for a position with no directive under it', () => {
    const editor = fakeEditor('plain text', 0, 3);
    expect(
      hoverAtViaEditor(editor, { line: 0, column: 3 }, calloutCatalog()),
    ).toBeUndefined();
  });

  it('reads a multi-line document at the given line index', () => {
    const editor = fakeEditor('first\n:::cal', 0, 0);
    const ctx = completeAtViaEditor(
      editor,
      { line: 1, column: 6 },
      calloutCatalog(),
    );
    expect(ctx.kind).toBe('directive-name');
  });
});

describe('hoverDocumentationText', () => {
  it('is non-empty for a standard component with a contract', () => {
    const [callout] = calloutCatalog();
    expect(hoverDocumentationText(callout!).length).toBeGreaterThan(0);
  });
});

describe('insertComponentPlan', () => {
  it('places the edit at the insertion point and computes a same-line cursor for a leaf skeleton', () => {
    const plan = insertComponentPlan(
      { directiveName: 'divider', kind: 'leaf' },
      'plain\n\ntext\n',
      3,
      0,
    );
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.line).toBe(3);
    expect(plan.edits[0]?.startColumn).toBe(0);
    expect(plan.edits[0]?.endColumn).toBe(0);
    expect(plan.edits[0]?.text).toContain('divider');
  });

  it('computes a cursor on a later line for a multi-line container skeleton', () => {
    const plan = insertComponentPlan(
      { directiveName: 'callout', kind: 'container' },
      'first\n\nthird\n',
      2,
      0,
    );
    // `componentSkeleton` for a required-attribute-free container is
    // `:::callout\n\n:::`; the cursor sits on the blank middle line.
    expect(plan.cursor.line).toBe(3);
    expect(plan.cursor.column).toBe(0);
  });

  it('offsets the cursor column on the insertion line itself when the skeleton has no newline before the cursor', () => {
    const plan = insertComponentPlan(
      { directiveName: 'kbd', kind: 'inline', requiredAttributes: [] },
      'plain text',
      0,
      4,
    );
    expect(plan.cursor.line).toBe(0);
    expect(plan.cursor.column).toBeGreaterThanOrEqual(4);
  });

  it('returns only the skeleton edit when there is no enclosing container', () => {
    const plan = insertComponentPlan(
      { directiveName: 'callout', kind: 'container' },
      'plain\n\ntext\n',
      1,
      0,
    );
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.line).toBe(1);
  });

  it('lengthens one enclosing container fence pair, ordered bottom-to-top with the insertion last', () => {
    const text = [':::card{}', '', '', ':::'].join('\n');
    const plan = insertComponentPlan(
      { directiveName: 'callout', kind: 'container' },
      text,
      2,
      0,
    );
    // Fence pair at lines 0/3, insertion at line 2: expect the closing
    // fence (line 3) first, then the insertion (line 2), then the opening
    // fence (line 0) last — descending by line.
    expect(plan.edits.map((edit) => edit.line)).toEqual([3, 2, 0]);
    const closing = plan.edits[0];
    const insertion = plan.edits[1];
    const opening = plan.edits[2];
    expect(closing?.text).toBe('::::');
    expect(opening?.text).toBe('::::');
    expect(insertion?.text).toContain('callout');
    // Neither fence edit lands on the insertion line.
    expect(closing?.line).not.toBe(2);
    expect(opening?.line).not.toBe(2);
  });

  it('lengthens the minimal set of nested enclosing fences, deepest handled first', () => {
    const text = ['::::center{}', ':::card{}', '', ':::', '::::'].join('\n');
    const plan = insertComponentPlan(
      { directiveName: 'callout', kind: 'container' },
      text,
      2,
      0,
    );
    // Enclosing pairs: card at lines 1/3 (4 colons -> 4 stays, since the
    // inserted container needs only 4), center at lines 0/4 (must grow
    // past card's own colon count). Both pairs' lines appear, in
    // descending order, with the insertion edit in the middle.
    const lines = plan.edits.map((edit) => edit.line);
    expect(lines).toEqual([...lines].sort((a, b) => b - a));
    expect(lines).toContain(2);
    const insertionIndex = lines.indexOf(2);
    // Every fence line below the insertion line comes before it in the
    // array, and every fence line above it comes after.
    expect(lines.slice(0, insertionIndex).every((line) => line > 2)).toBe(true);
    expect(lines.slice(insertionIndex + 1).every((line) => line < 2)).toBe(
      true,
    );
  });

  it('never throws on hostile input, degrading to the skeleton edit alone', () => {
    const plan = insertComponentPlan(
      { directiveName: 'callout', kind: 'container' },
      undefined as unknown as string,
      0,
      0,
    );
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.text).toContain('callout');
  });
});
