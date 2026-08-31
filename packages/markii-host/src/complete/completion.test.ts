import { describe, expect, it } from 'vitest';
import type { PackComponentEntry } from '@markii/pack';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import type { DiscoveredPack } from '../packs/discover.js';
import { completionAt, hoverAt } from './completion.js';

function pack(
  name: string,
  components: Record<string, PackComponentEntry>,
): DiscoveredPack {
  return {
    folder: `/packs/${name}`,
    manifest: { name, engine: 'react', components },
    componentPaths: {},
    scriptsDir: `/packs/${name}/scripts`,
    scriptPath: `/packs/${name}/webview.js`,
  };
}

const STANDARD_CATALOG = buildComponentCatalog([]);

function labels(items: readonly { label: string }[]): string[] {
  return items.map((i) => i.label).sort();
}

describe('completionAt — directive-name context', () => {
  it('offers only leaf components for a two-colon opener', () => {
    const ctx = completionAt('::sta', 5, STANDARD_CATALOG);
    expect(ctx.kind).toBe('directive-name');
    const names = labels(ctx.items);
    expect(names).toContain('stat');
    expect(names).not.toContain('callout'); // callout is a container
  });

  it('offers only container components for a three-colon opener', () => {
    const ctx = completionAt(':::cal', 6, STANDARD_CATALOG);
    const names = labels(ctx.items);
    expect(names).toContain('callout');
    expect(names).not.toContain('kbd'); // kbd is inline
  });

  it('offers only inline components for a single-colon opener', () => {
    const ctx = completionAt(':kb', 3, STANDARD_CATALOG);
    const names = labels(ctx.items);
    expect(names).toContain('kbd');
    expect(names).not.toContain('callout');
  });

  it('includes the layout wrappers among container offerings', () => {
    const ctx = completionAt(':::c', 4, STANDARD_CATALOG);
    const names = labels(ctx.items);
    expect(names).toContain('center');
  });

  it('offers a kindDeclared:false pack component in every directive form', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]);
    const leaf = labels(completionAt('::cat', 5, catalog).items);
    const container = labels(completionAt(':::cat', 6, catalog).items);
    const inline = labels(completionAt(':cat', 4, catalog).items);
    expect(leaf).toContain('cat_card');
    expect(container).toContain('cat_card');
    expect(inline).toContain('cat_card');
  });

  it('builds a kindDeclared:false pack component skeleton in the form the author typed', () => {
    // The catalog defaults an undeclared pack component to `'container'`,
    // but that is a default and not a fact. Inserting a container skeleton
    // for an author who typed `::` would rewrite their two colons into a
    // two-colon fence, which is not a container at all.
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]);
    const leaf = completionAt('::cat', 5, catalog).items.find(
      (i) => i.label === 'cat_card',
    );
    expect(leaf?.insertText).toBe('::cat_card{}');

    const inline = completionAt(':cat', 4, catalog).items.find(
      (i) => i.label === 'cat_card',
    );
    expect(inline?.insertText).toBe(':cat_card[]');

    const container = completionAt(':::cat', 6, catalog).items.find(
      (i) => i.label === 'cat_card',
    );
    expect(container?.insertText).toBe(':::cat_card{}\n\n:::');
  });

  it('offers a kindDeclared:true pack component only in its declared form', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { profile: { source: './P.tsx', kind: 'leaf' } }),
    ]);
    const leaf = labels(completionAt('::cat', 5, catalog).items);
    const container = labels(completionAt(':::cat', 6, catalog).items);
    expect(leaf).toContain('cat_profile');
    expect(container).not.toContain('cat_profile');
  });

  it('inserts the full skeleton when the rest of the line is empty, replacing from the colon run start', () => {
    const ctx = completionAt(':::cal', 6, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'callout')!;
    expect(ctx.replaceStart).toBe(0);
    expect(ctx.replaceEnd).toBe(6);
    expect(item.insertText).toBe(':::callout{}\n\n:::');
    expect(item.insertCursorOffset).toBe(':::callout{}\n'.length);
  });

  it('emits a fence matching a typed four-colon nesting run', () => {
    const ctx = completionAt('::::tabs', 8, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'tabs');
    expect(item?.insertText).toBe('::::tabs{}\n\n::::');
  });

  it('inserts the bare name only when there is trailing content, replacing from the name start', () => {
    const ctx = completionAt(':::cal{type=warning}', 6, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'callout')!;
    expect(ctx.replaceStart).toBe(3); // after ":::"
    expect(item.insertText).toBe('callout');
    expect(item.insertCursorOffset).toBe('callout'.length);
  });

  it('pre-fills a required attribute in the skeleton and points the cursor inside its quotes', () => {
    const ctx = completionAt(':::fig', 6, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'figure')!;
    expect(item.insertText).toBe(':::figure{src=""}\n\n:::');
  });

  it('carries detail, group, and documentation through', () => {
    const ctx = completionAt(':::cal', 6, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'callout')!;
    expect(item.group).toBe('standard');
    expect(item.detail.length).toBeGreaterThan(0);
    expect(item.documentation?.example).toBe(':::callout{}');
  });

  it('carries packName through for a pack component item', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]);
    const ctx = completionAt('::cat', 5, catalog);
    const item = ctx.items.find((i) => i.label === 'cat_card');
    expect(item?.packName).toBe('cat');
    expect(item?.group).toBe('pack');
  });
});

describe('completionAt — attribute-name context', () => {
  it('offers a standard component contract attributes, minus what is already present', () => {
    const ctx = completionAt('::callout{type=warning ', 24, STANDARD_CATALOG);
    expect(ctx.kind).toBe('attribute-name');
    const names = labels(ctx.items);
    expect(names).toContain('title');
    expect(names).not.toContain('type');
  });

  it('adds width and align on a block form', () => {
    const ctx = completionAt('::callout{', 10, STANDARD_CATALOG);
    const names = labels(ctx.items);
    expect(names).toContain('width');
    expect(names).toContain('align');
  });

  it('never offers width/align on an inline form', () => {
    const ctx = completionAt(':kbd{', 5, STANDARD_CATALOG);
    const names = labels(ctx.items);
    expect(names).not.toContain('width');
    expect(names).not.toContain('align');
  });

  it('offers only width/align for a pack component (no contract)', () => {
    const catalog = buildComponentCatalog([
      pack('cat', { card: './Card.tsx' }),
    ]);
    const ctx = completionAt('::cat_card{', 11, catalog);
    expect(labels(ctx.items)).toEqual(['align', 'width']);
  });

  it('formats insertText as name="" with the cursor between the quotes', () => {
    const ctx = completionAt('::callout{', 10, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'title')!;
    expect(item.insertText).toBe('title=""');
    expect(item.insertCursorOffset).toBe('title="'.length);
  });

  it('prefixes a required attribute detail with "required."', () => {
    const ctx = completionAt(':::figure{', 10, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'src')!;
    expect(item.detail.startsWith('required. ')).toBe(true);
  });

  it('does not prefix an optional attribute detail', () => {
    const ctx = completionAt('::callout{', 10, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'title')!;
    expect(item.detail.startsWith('required.')).toBe(false);
  });
});

describe('completionAt — attribute-value context', () => {
  it('offers a standard attribute enum', () => {
    const ctx = completionAt('::callout{type=', 15, STANDARD_CATALOG);
    expect(ctx.kind).toBe('attribute-value');
    expect(labels(ctx.items)).toEqual(['danger', 'info', 'warning']);
  });

  it('offers the width preset enum on a block form', () => {
    const ctx = completionAt('::callout{width=', 16, STANDARD_CATALOG);
    expect(ctx.kind).toBe('attribute-value');
    expect(labels(ctx.items)).toEqual(['full', 'narrow', 'normal', 'wide']);
  });

  it('returns none (not an empty attribute-value context) when the attribute has no enum', () => {
    const ctx = completionAt('::callout{title=', 16, STANDARD_CATALOG);
    expect(ctx.kind).toBe('none');
    expect(ctx.items).toEqual([]);
  });

  it('inserts the bare value when a closing quote already follows', () => {
    const ctx = completionAt('::callout{type="w"}', 16, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'warning')!;
    expect(item.insertText).toBe('warning');
  });

  it('appends the opening quote character when there is no closing quote', () => {
    const ctx = completionAt('::callout{type="w', 17, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'warning')!;
    expect(item.insertText).toBe('warning"');
  });

  it('inserts a bare value with no quote at all for an unquoted attribute', () => {
    const ctx = completionAt('::callout{type=w', 16, STANDARD_CATALOG);
    const item = ctx.items.find((i) => i.label === 'warning')!;
    expect(item.insertText).toBe('warning');
  });

  it('insertCursorOffset is always the length of the inserted text', () => {
    const ctx = completionAt('::callout{type=', 15, STANDARD_CATALOG);
    for (const item of ctx.items) {
      expect(item.insertCursorOffset).toBe(item.insertText.length);
    }
  });
});

describe('completionAt — none', () => {
  it('returns none with replaceStart === replaceEnd === column for plain prose', () => {
    const ctx = completionAt('just some text', 5, STANDARD_CATALOG);
    expect(ctx.kind).toBe('none');
    expect(ctx.replaceStart).toBe(5);
    expect(ctx.replaceEnd).toBe(5);
    expect(ctx.items).toEqual([]);
  });
});

describe('completionAt — never throws', () => {
  it('never throws for a hostile __proto__ directive name', () => {
    expect(() =>
      completionAt('::__proto__{', 12, STANDARD_CATALOG),
    ).not.toThrow();
  });

  it('never throws for a constructor attribute name', () => {
    expect(() =>
      completionAt('::callout{constructor=', 23, STANDARD_CATALOG),
    ).not.toThrow();
  });

  it('never throws for a column past the end of the line', () => {
    expect(() =>
      completionAt('::callout{', 9999, STANDARD_CATALOG),
    ).not.toThrow();
  });

  it('never throws for a negative column', () => {
    expect(() =>
      completionAt('::callout{', -9999, STANDARD_CATALOG),
    ).not.toThrow();
  });

  it('never throws for an empty line', () => {
    expect(() => completionAt('', 0, STANDARD_CATALOG)).not.toThrow();
  });

  it('never throws for a line of only colons', () => {
    expect(() => completionAt(':::::', 5, STANDARD_CATALOG)).not.toThrow();
  });

  it('never throws for an unterminated brace', () => {
    expect(() =>
      completionAt('::callout{type=warning', 23, STANDARD_CATALOG),
    ).not.toThrow();
  });

  it('never throws for an unterminated quote', () => {
    expect(() =>
      completionAt('::callout{title="abc', 21, STANDARD_CATALOG),
    ).not.toThrow();
  });
});

describe('hoverAt', () => {
  it('resolves a standard component under the cursor', () => {
    const info = hoverAt('::callout{}', 5, STANDARD_CATALOG);
    expect(info?.directiveName).toBe('callout');
    expect(info?.start).toBe(2);
    expect(info?.end).toBe(9);
  });

  it('resolves when the cursor sits at either end of the name', () => {
    expect(hoverAt('::callout{}', 2, STANDARD_CATALOG)?.directiveName).toBe(
      'callout',
    );
    expect(hoverAt('::callout{}', 9, STANDARD_CATALOG)?.directiveName).toBe(
      'callout',
    );
  });

  it('returns undefined when the cursor is not on a directive name', () => {
    expect(hoverAt('plain text', 3, STANDARD_CATALOG)).toBeUndefined();
  });

  it('returns undefined for an unregistered directive name', () => {
    expect(hoverAt('::mystery{}', 4, STANDARD_CATALOG)).toBeUndefined();
  });

  it('never throws for a hostile __proto__ directive name', () => {
    expect(() => hoverAt('::__proto__{}', 4, STANDARD_CATALOG)).not.toThrow();
  });

  it('never throws for an out-of-range column', () => {
    expect(() => hoverAt('::callout{}', 9999, STANDARD_CATALOG)).not.toThrow();
    expect(() => hoverAt('::callout{}', -9999, STANDARD_CATALOG)).not.toThrow();
  });

  it('never throws for an empty line', () => {
    expect(() => hoverAt('', 0, STANDARD_CATALOG)).not.toThrow();
  });
});
