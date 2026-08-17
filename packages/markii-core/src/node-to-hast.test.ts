import { describe, expect, it } from 'vitest';
import type { Root as HastRoot, Element as HastElement } from 'hast';
import { parse } from './parse';
import { toHast, nodeToHast } from './to-hast';
import type { MarkNode } from './to-hast';
import { stripPositions } from './corpus';

/**
 * A document exercising every node shape `nodeToHast` needs to handle
 * identically to `toHast`: plain prose (heading/paragraph/blockquote/lists),
 * GFM constructs (table, task list), every directive shape (container, leaf,
 * text), a script code fence, and — inside the second paragraph — both an
 * unsafe link and an unsafe image, to prove URL sanitizing genuinely runs on
 * the single-node path too.
 */
const DOCUMENT = [
  '# Heading',
  '',
  'A paragraph with a [good link](https://example.com).',
  '',
  'A paragraph with a [bad link](javascript:alert(1)) and an image ![alt](javascript:alert(2)).',
  '',
  '> A blockquote.',
  '',
  '- item one',
  '- item two',
  '',
  '- [x] done',
  '- [ ] not done',
  '',
  '| Name | Role     |',
  '| ---- | -------- |',
  '| Ada  | Engineer |',
  '',
  ':::callout{type=warning title="Careful"}',
  'Inside a container directive.',
  ':::',
  '',
  '::rating{value=3 max=5}',
  '',
  'Text with :kbd[Ctrl+S] inline directive.',
  '',
  '```lua {name=stars}',
  'return 1',
  '```',
].join('\n');

/** Strips `position` and re-serializes through JSON, matching corpus fixture comparison style. */
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(stripPositions(value)));
}

/**
 * `mdast-util-to-hast` interleaves plain `"\n"` text nodes between sibling
 * block-level hast elements at the whole-document root, purely for nicer
 * serialization — they carry no structural information (no mdast node
 * produces them) and are exactly the "whitespace-text differences" the task
 * calls out to ignore. Filtering `root.children` down to `element` nodes
 * recovers the true 1:1 mapping to `tree.children` without weakening
 * anything else about the comparison.
 */
function elementChildren(root: HastRoot): HastElement[] {
  return root.children.filter(
    (child): child is HastElement => child.type === 'element',
  );
}

describe('nodeToHast: parity with toHast', () => {
  it('converts every top-level node identically to the whole-document pipeline', () => {
    const tree = parse(DOCUMENT);
    const wholeDocHast = toHast(DOCUMENT);
    const wholeDocElements = elementChildren(wholeDocHast);

    expect(tree.children.length).toBe(wholeDocElements.length);

    tree.children.forEach((node, index) => {
      const nodeHast = nodeToHast(node);
      const nodeElements = elementChildren(nodeHast);
      expect(nodeElements).toHaveLength(1);
      expect(normalize(nodeElements[0])).toEqual(
        normalize(wholeDocElements[index]),
      );
    });
  });

  it('produces a root with exactly one child per single node converted', () => {
    const tree = parse('Just one paragraph.');
    const nodeHast = nodeToHast(tree.children[0]!);
    expect(nodeHast.type).toBe('root');
    expect(nodeHast.children).toHaveLength(1);
  });
});

describe('nodeToHast: purity', () => {
  it('never mutates the caller-supplied node', () => {
    const tree = parse(DOCUMENT);
    const before = tree.children.map((node) =>
      JSON.parse(JSON.stringify(node)),
    );

    for (const node of tree.children) {
      nodeToHast(node);
    }

    const after = tree.children.map((node) => JSON.parse(JSON.stringify(node)));
    expect(after).toEqual(before);
  });

  it('leaves a directive node with no data.hName/hProperties after conversion', () => {
    const tree = parse('::rating{value=3 max=5}');
    const directiveNode = tree.children[0]!;
    expect((directiveNode as { data?: unknown }).data).toBeUndefined();

    nodeToHast(directiveNode);

    expect((directiveNode as { data?: unknown }).data).toBeUndefined();
  });

  it('leaves a code node with no data.hProperties after conversion', () => {
    const tree = parse('```lua {name=stars}\nreturn 1\n```');
    const codeNode = tree.children[0]!;
    expect((codeNode as { data?: unknown }).data).toBeUndefined();

    nodeToHast(codeNode);

    expect((codeNode as { data?: unknown }).data).toBeUndefined();
  });
});

describe('nodeToHast: URL sanitizing runs on the single-node path', () => {
  it('strips the href of a javascript: link and the src of a javascript: image', () => {
    const tree = parse(
      'A paragraph with a [bad link](javascript:alert(1)) and an image ![alt](javascript:alert(2)).',
    );
    const paragraphHast = nodeToHast(tree.children[0]!);

    function findAll(node: HastRoot, tagName: string): HastElement[] {
      const results: HastElement[] = [];
      function walk(n: HastRoot | HastElement): void {
        for (const child of n.children) {
          if (child.type === 'element') {
            if (child.tagName === tagName) results.push(child);
            walk(child);
          }
        }
      }
      walk(node);
      return results;
    }

    const links = findAll(paragraphHast, 'a');
    expect(links).toHaveLength(1);
    expect(links[0]?.properties.href).toBeUndefined();

    const images = findAll(paragraphHast, 'img');
    expect(images).toHaveLength(1);
    expect(images[0]?.properties.src).toBeUndefined();
  });

  it('keeps a safe URL intact for contrast', () => {
    const tree = parse('A [good link](https://example.com).');
    const paragraphHast = nodeToHast(tree.children[0]!);
    const link = paragraphHast.children.find(
      (child): child is HastElement =>
        child.type === 'element' && child.tagName === 'p',
    );
    expect(link).toBeDefined();
  });
});

describe('nodeToHast: never throws on odd input', () => {
  it('does not throw on an inline/text-level node at the root', () => {
    expect(() =>
      nodeToHast({ type: 'text', value: 'bare text' }),
    ).not.toThrow();
  });

  it('does not throw on a code node with malformed meta', () => {
    expect(() =>
      nodeToHast({
        type: 'code',
        lang: 'lua',
        meta: '{name=x publish="unterminated',
        value: 'return 1',
      }),
    ).not.toThrow();
  });

  it('does not throw on an unclosed container-directive subtree', () => {
    const tree = parse(
      ':::callout{type=danger title="Unclosed"}\nThis never closes.\n',
    );
    expect(() => nodeToHast(tree.children[0]!)).not.toThrow();
  });

  it('always returns a hast root even for odd input', () => {
    const result = nodeToHast({ type: 'text', value: 'bare text' });
    expect(result.type).toBe('root');
    expect(Array.isArray(result.children)).toBe(true);
  });
});

describe('nodeToHast: caller-supplied hast overrides are stripped (injection guard)', () => {
  it('ignores a tampered data.hName/hProperties instead of emitting the requested tag', () => {
    const [paragraph] = parse('hello world').children;
    const tampered = {
      ...paragraph,
      data: { hName: 'script', hProperties: { src: 'javascript:alert(1)' } },
    } as MarkNode;

    const result = nodeToHast(tampered);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('javascript:');
    // Renders exactly as if the node had carried no `data` at all.
    expect(normalize(result)).toEqual(normalize(nodeToHast(paragraph!)));
  });

  it('ignores a tampered data.hChildren instead of splicing in caller-built hast', () => {
    const [paragraph] = parse('hello world').children;
    const tampered = {
      ...paragraph,
      data: {
        hChildren: [
          {
            type: 'element',
            tagName: 'iframe',
            properties: { src: 'javascript:alert(2)' },
            children: [],
          },
        ],
      },
    } as MarkNode;

    const result = nodeToHast(tampered);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('iframe');
    expect(serialized).not.toContain('javascript:');
    expect(normalize(result)).toEqual(normalize(nodeToHast(paragraph!)));
  });

  it('strips overrides on NESTED nodes, not just the node handed in', () => {
    const [quote] = parse('> quoted [text](https://example.com)').children;
    const cloned = structuredClone(quote!) as MarkNode & {
      children: { data?: unknown }[];
    };
    cloned.children[0]!.data = {
      hName: 'script',
      hProperties: { src: 'javascript:alert(3)' },
    };

    const serialized = JSON.stringify(nodeToHast(cloned));
    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('javascript:');
  });

  it('still tags directives and preserves code meta after the strip', () => {
    const [directive] = parse('::rating{value=3 max=5}').children;
    const [code] = parse('```lua {name=stars}\nreturn 1\n```').children;

    expect(JSON.stringify(nodeToHast(directive!))).toContain('mk-directive');
    expect(JSON.stringify(nodeToHast(code!))).toContain('data-mk-meta');
  });
});

describe('nodeToHast: a frontmatter node degrades quietly', () => {
  it('returns an empty root for a yaml node handed in on its own', () => {
    const [yamlNode] = parse('---\nuses: [ana]\n---\n\nBody.\n').children;
    expect(yamlNode?.type).toBe('yaml');
    const tree = nodeToHast(yamlNode!);
    expect(tree).toEqual({ type: 'root', children: [] });
    expect(JSON.stringify(tree)).not.toContain('uses');
  });

  it('matches toHast: neither path renders frontmatter content', () => {
    const source = '---\ntitle: Secret\n---\n\nBody.\n';
    const [yamlNode] = parse(source).children;
    expect(JSON.stringify(nodeToHast(yamlNode!))).not.toContain('Secret');
    expect(JSON.stringify(toHast(source))).not.toContain('Secret');
  });

  it('never throws on a hand-built yaml node with a hostile value', () => {
    const node: MarkNode = {
      type: 'yaml',
      value: '__proto__: {polluted: true}\nuses: [<script>]',
    };
    expect(() => nodeToHast(node)).not.toThrow();
    expect(JSON.stringify(nodeToHast(node))).not.toContain('script');
  });
});
