import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from 'mdast-util-directive';
import type { Code, RootContent } from 'mdast';
import type { Node } from 'unist';
import { parse } from './parse';
import { conformanceDir } from './corpus';

function readFixture(name: string): string {
  return readFileSync(join(conformanceDir(), name), 'utf8');
}

function hasChildren(node: Node): node is Node & { children: Node[] } {
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children);
}

function findAll<T extends RootContent['type']>(
  tree: Node,
  type: T,
): Extract<RootContent, { type: T }>[] {
  const results: Extract<RootContent, { type: T }>[] = [];
  const visit = (node: Node): void => {
    if (node.type === type) {
      results.push(node as Extract<RootContent, { type: T }>);
    }
    if (hasChildren(node)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(tree);
  return results;
}

describe('parse', () => {
  it('parses plain CommonMark with no directive nodes', () => {
    const tree = parse(readFixture('01-plain-markdown.mk.md'));
    expect(tree.type).toBe('root');
    expect(findAll(tree, 'containerDirective')).toHaveLength(0);
    expect(findAll(tree, 'leafDirective')).toHaveLength(0);
    expect(findAll(tree, 'textDirective')).toHaveLength(0);
    expect(findAll(tree, 'heading')).toHaveLength(1);
    expect(findAll(tree, 'listItem')).toHaveLength(3);
  });

  it('parses an inline text directive with a label', () => {
    const tree = parse(readFixture('02-inline-directive.mk.md'));
    const directives = findAll(tree, 'textDirective') as TextDirective[];
    expect(directives).toHaveLength(2);
    expect(directives[0]?.name).toBe('kbd');
    const label = directives[0]?.children[0];
    expect(label?.type).toBe('text');
    expect(label && 'value' in label ? label.value : undefined).toBe('Ctrl+S');
  });

  it('parses a leaf directive with attributes', () => {
    const tree = parse(readFixture('03-leaf-directive.mk.md'));
    const directives = findAll(tree, 'leafDirective') as LeafDirective[];
    expect(directives).toHaveLength(1);
    expect(directives[0]?.name).toBe('rating');
    expect(directives[0]?.attributes).toEqual({ value: '3', max: '5' });
  });

  it('parses a container directive holding block markdown children', () => {
    const tree = parse(readFixture('04-container-directive.mk.md'));
    const directives = findAll(
      tree,
      'containerDirective',
    ) as ContainerDirective[];
    expect(directives).toHaveLength(1);
    const directive = directives[0];
    expect(directive?.name).toBe('callout');
    expect(directive?.attributes).toEqual({
      type: 'warning',
      title: 'Careful',
    });
    expect(directive?.children[0]?.type).toBe('paragraph');
  });

  it('parses quoted, bare, and missing attributes', () => {
    const tree = parse(readFixture('05-attributes.mk.md'));
    const directives = findAll(
      tree,
      'containerDirective',
    ) as ContainerDirective[];
    expect(directives).toHaveLength(4);
    expect(directives[0]?.attributes).toEqual({
      type: 'warning',
      title: 'Quoted title with spaces',
    });
    expect(directives[1]?.attributes).toEqual({ type: 'danger' });
    expect(directives[2]?.attributes ?? {}).toEqual({});
    // mdast-util-directive represents a bare (valueless) attribute as an
    // empty string at the parse layer (see render.tsx's normalizeAttributes
    // for the ''->null normalization the render layer applies on top).
    expect(directives[3]?.attributes).toEqual({
      type: 'info',
      collapsed: '',
    });
  });

  it('parses directives nested inside directives, with true parent/child nesting', () => {
    const tree = parse(readFixture('06-nested-directives.mk.md'));
    const outer = findAll(tree, 'containerDirective') as ContainerDirective[];
    expect(outer).toHaveLength(2);
    const outerCallout = outer.find((d) => d.attributes?.title === 'Nested');
    const innerCallout = outer.find((d) => d.attributes?.title === 'Inner');
    expect(outerCallout).toBeDefined();
    expect(innerCallout).toBeDefined();

    // Must be true nesting (the inner containerDirective is a descendant of
    // the outer's own children), not two directives that merely both exist
    // in the document — which is what malformed input with equal fence
    // lengths would produce instead (the outer closes early and the
    // "inner" directive becomes a sibling, not a child).
    const nestedContainers = findAll(
      outerCallout as ContainerDirective,
      'containerDirective',
    );
    expect(nestedContainers).toContainEqual(innerCallout);

    const nestedLeaf = findAll(
      outerCallout as ContainerDirective,
      'leafDirective',
    ) as LeafDirective[];
    const nestedText = findAll(
      outerCallout as ContainerDirective,
      'textDirective',
    ) as TextDirective[];
    expect(nestedLeaf.some((d) => d.name === 'rating')).toBe(true);
    expect(nestedText.some((d) => d.name === 'kbd')).toBe(true);
  });

  it('parses unknown directive names into generic directive nodes', () => {
    const tree = parse(readFixture('07-unknown-directive.mk.md'));
    const text = findAll(tree, 'textDirective') as TextDirective[];
    const leaf = findAll(tree, 'leafDirective') as LeafDirective[];
    const container = findAll(
      tree,
      'containerDirective',
    ) as ContainerDirective[];
    expect(text[0]?.name).toBe('badge');
    expect(leaf[0]?.name).toBe('timeline');
    // mdast-util-directive represents a bare (valueless) attribute as an
    // empty string at the parse layer; the render layer normalizes this to
    // `null` for the registry-facing DirectiveAttributes contract (see
    // render.tsx's tagDirectiveNodes).
    expect(leaf[0]?.attributes).toEqual({ src: 'repo.json', collapsed: '' });
    expect(container[0]?.name).toBe('widget');
  });

  it('does not parse directive-like text inside a fenced code block', () => {
    const tree = parse(readFixture('08-code-fence.mk.md'));
    const containers = findAll(
      tree,
      'containerDirective',
    ) as ContainerDirective[];
    expect(containers).toHaveLength(1);
    expect(containers[0]?.attributes).toEqual({ type: 'info', title: 'Real' });

    const codeBlocks = findAll(tree, 'code') as Code[];
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.value).toContain(
      ':::callout{type=warning title="Not real"}',
    );
    expect(codeBlocks[0]?.value).toContain(':kbd[Ctrl+S]');
  });

  it('does not throw on an unclosed container directive', () => {
    expect(() =>
      parse(readFixture('09-malformed-container.mk.md')),
    ).not.toThrow();
    const tree = parse(readFixture('09-malformed-container.mk.md'));
    expect(tree.type).toBe('root');
  });
});

describe('parse — GFM (tables, task lists, strikethrough, autolinks)', () => {
  it('parses a GFM table into table/tableRow/tableCell nodes, alongside a directive in the same document', () => {
    const tree = parse(readFixture('12-gfm-table.mk.md'));
    const tables = findAll(tree, 'table');
    expect(tables).toHaveLength(1);
    const rows = findAll(tables[0] as Node, 'tableRow');
    expect(rows).toHaveLength(3); // header + 2 data rows
    const cells = findAll(tables[0] as Node, 'tableCell');
    expect(cells).toHaveLength(9);

    // The document also has a `:::callout` directive after the table — GFM
    // and directive syntax must both parse in the same document.
    const containers = findAll(tree, 'containerDirective');
    expect(containers).toHaveLength(1);
  });

  it("parses a GFM task list, recording `checked` per item, and leaves an ordinary list item's `checked` unset", () => {
    const tree = parse(readFixture('13-task-list.mk.md'));
    const items = findAll(tree, 'listItem') as Array<
      RootContent & { checked?: boolean | null }
    >;
    expect(items.map((item) => item.checked)).toEqual([
      true,
      false,
      false,
      null,
      null,
    ]);
  });

  it('parses GFM strikethrough into a `delete` node and a bare URL into a GFM literal autolink `link` node, alongside an inline directive', () => {
    const tree = parse(readFixture('14-strikethrough.mk.md'));
    const struck = findAll(tree, 'delete');
    expect(struck).toHaveLength(1);

    const links = findAll(tree, 'link');
    expect(links).toHaveLength(1);
    expect((links[0] as { url?: string }).url).toBe(
      'https://example.com/bare-autolink',
    );

    const textDirectives = findAll(tree, 'textDirective');
    expect(textDirectives).toHaveLength(1);
  });

  it('composes directive and GFM extensions regardless of `.use()` order (empirically: both parse correctly in one document)', () => {
    const tree = parse(
      [
        ':::callout{type=info title="Mixed"}',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- [x] done',
        '',
        '~~gone~~ and :kbd[Ctrl+S]',
        ':::',
      ].join('\n'),
    );
    const container = findAll(tree, 'containerDirective')[0];
    expect(container).toBeDefined();
    expect(findAll(container as Node, 'table')).toHaveLength(1);
    expect(findAll(container as Node, 'listItem')).toHaveLength(1);
    expect(findAll(container as Node, 'delete')).toHaveLength(1);
    expect(findAll(container as Node, 'textDirective')).toHaveLength(1);
  });
});
