import { describe, expect, it } from 'vitest';
import { visit } from 'unist-util-visit';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { toHast } from './to-hast';

function findElement(tree: HastRoot, tagName: string): HastElement | undefined {
  let found: HastElement | undefined;
  visit(tree, 'element', (node: HastElement) => {
    if (!found && node.tagName === tagName) found = node;
  });
  return found;
}

function textOf(node: HastElement): string {
  let text = '';
  visit(node, 'text', (textNode: { value: string }) => {
    text += textNode.value;
  });
  return text;
}

describe('URL sanitization (hast level)', () => {
  it('neutralizes a javascript: URL in a link href but keeps the link text', () => {
    const tree = toHast('[click me](javascript:alert(1))');
    const link = findElement(tree, 'a');
    expect(link).toBeDefined();
    expect(link?.properties.href).toBeUndefined();
    expect(textOf(link as HastElement)).toBe('click me');
  });

  it('neutralizes uppercase and whitespace-padded javascript: URLs', () => {
    const mixedCase = findElement(
      toHast('[click me](JaVaScRiPt:alert(1))'),
      'a',
    );
    expect(mixedCase?.properties.href).toBeUndefined();

    // `&#32;` is a decoded character reference, so the destination the
    // parser hands us is the literal string " JaVaScRiPt:alert(1)" (real
    // leading space, mixed case) — proves the scheme check is a strict
    // match, not a `startsWith('javascript:')` check a leading space (or
    // case change) could sneak past.
    const padded = findElement(
      toHast('[again](<&#32;JaVaScRiPt:alert(1)>)'),
      'a',
    );
    expect(padded?.properties.href).toBeUndefined();
  });

  it('neutralizes a data: URL in an image src but keeps the image element', () => {
    const tree = toHast('![alt text](data:text/html,alert(1))');
    const img = findElement(tree, 'img');
    expect(img).toBeDefined();
    expect(img?.properties.alt).toBe('alt text');
    expect(img?.properties.src).toBeUndefined();
  });

  it('preserves http, https, mailto, tel, relative, fragment, and query URLs', () => {
    const cases: Array<[string, string]> = [
      ['https link', 'https://example.com'],
      ['http link', 'http://example.com'],
      ['mailto link', 'mailto:person@example.com'],
      ['tel link', 'tel:+15555550100'],
      ['relative link', '/notes/today'],
      ['fragment link', '#section'],
      ['query link', '?tab=info'],
    ];
    for (const [text, url] of cases) {
      const link = findElement(toHast(`[${text}](${url})`), 'a');
      expect(link?.properties.href).toBe(url);
    }
  });
});

describe('GFM (hast level)', () => {
  it('renders a GFM table as <table>/<tr>/<td>, with a directive after it in the same document', () => {
    const tree = toHast(
      '| A | B |\n| - | - |\n| 1 | 2 |\n\n:::callout{type=info title="Note"}\nhi\n:::',
    );
    expect(findElement(tree, 'table')).toBeDefined();
    expect(findElement(tree, 'tr')).toBeDefined();
    expect(findElement(tree, 'td')).toBeDefined();
    // The directive is still tagged for the renderer, not swallowed by GFM.
    expect(findElement(tree, 'mk-directive')).toBeDefined();
  });

  it('renders a GFM task list item as a checkbox <input>, with the correct checked state', () => {
    const tree = toHast('- [x] done\n- [ ] not done');
    const inputs: HastElement[] = [];
    visit(tree, 'element', (node: HastElement) => {
      if (node.tagName === 'input') inputs.push(node);
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.properties.checked).toBe(true);
    expect(inputs[1]?.properties.checked).toBeFalsy();
  });

  it('renders GFM strikethrough as <del>', () => {
    const tree = toHast('~~gone~~');
    const del = findElement(tree, 'del');
    expect(del).toBeDefined();
    expect(textOf(del as HastElement)).toBe('gone');
  });

  it('neutralizes a hostile javascript: URL reached via a GFM literal (bare-URL) autolink', () => {
    // GFM literal autolinks only trigger on a real URL, so this proves the
    // *href renderer* (a data: URL smuggled in as link text won't parse as
    // a GFM autolink at all) — the meaningful hostile-autolink case is a
    // CommonMark `<javascript:...>` autolink, which GFM's literal-autolink
    // extension does not affect but which must still be sanitized with GFM
    // enabled.
    const tree = toHast('<javascript:alert(1)>');
    const link = findElement(tree, 'a');
    expect(link).toBeDefined();
    expect(link?.properties.href).toBeUndefined();
  });

  it('preserves a safe https GFM literal autolink href', () => {
    const tree = toHast('Visit https://example.com/page for more.');
    const link = findElement(tree, 'a');
    expect(link?.properties.href).toBe('https://example.com/page');
  });
});

describe('code-fence meta preservation (hast level)', () => {
  it('preserves a fence meta string onto the hast <code> element as data-mk-meta', () => {
    const tree = toHast('```lua {name=stars}\nreturn 1\n```');
    const code = findElement(tree, 'code');
    expect(code?.properties['data-mk-meta']).toBe('{name=stars}');
    // The language class mdast-util-to-hast already adds must survive
    // untouched alongside the new attribute.
    expect(code?.properties.className).toEqual(['language-lua']);
  });

  it('leaves an ordinary code fence with no meta unmarked', () => {
    const tree = toHast('```lua\nprint("hi")\n```');
    const code = findElement(tree, 'code');
    expect(code?.properties['data-mk-meta']).toBeUndefined();
  });

  it('does not add data-mk-meta to a fence with no meta and no language either', () => {
    const tree = toHast('```\nplain\n```');
    const code = findElement(tree, 'code');
    expect(code?.properties['data-mk-meta']).toBeUndefined();
  });
});

/**
 * Raw HTML MUST NOT be rendered (docs/spec.md §1): the parser still emits an
 * `html` mdast node (conformance fixture 29 pins that parse-level fact) so a
 * host can inspect it, but nothing may reach the hast tree from it.
 * `mdast-util-to-hast` has no default handler for `html`, so the node is
 * dropped rather than converted. This is pinned here as a rendering
 * guarantee of the format, matching the frontmatter-drop test below, so a
 * future dependency change that started passing raw HTML through fails
 * loudly instead of silently reopening an HTML-injection path.
 */
describe('raw HTML (hast level)', () => {
  it('drops a raw HTML block entirely, keeping the surrounding content', () => {
    const tree = toHast('Before.\n\n<div class="raw">nope</div>\n\nAfter.\n');
    const serialized = JSON.stringify(tree);
    expect(serialized).not.toContain('raw');
    expect(serialized).not.toContain('nope');
    const paragraphs: string[] = [];
    visit(tree, 'element', (node: HastElement) => {
      if (node.tagName === 'p') paragraphs.push(textOf(node));
    });
    expect(paragraphs).toEqual(['Before.', 'After.']);
  });
});

/**
 * Frontmatter is metadata, never content: a leading `---` block must leave
 * no trace in the rendered tree. `mdast-util-to-hast` maps `yaml` to its
 * `ignore` handler today, but this is a guarantee of the format rather than
 * an incidental upstream default, so it is pinned here — if a future
 * dependency release started emitting the block as text, this fails loudly
 * instead of silently spilling `title:`/`uses:` lines into every document.
 */
describe('frontmatter (hast level)', () => {
  it('drops a leading frontmatter block entirely', () => {
    const tree = toHast('---\ntitle: Notes\nuses: [ana]\n---\n\n# Hello\n');
    const serialized = JSON.stringify(tree);
    expect(serialized).not.toContain('title: Notes');
    expect(serialized).not.toContain('uses');
    expect(findElement(tree, 'h1')).toBeDefined();
    expect(findElement(tree, 'hr')).toBeUndefined();
  });

  it('still renders a mid-document --- as an <hr>', () => {
    const tree = toHast('Before.\n\n---\n\nAfter.\n');
    expect(findElement(tree, 'hr')).toBeDefined();
  });

  it('renders an unclosed opening --- as an <hr> plus ordinary text', () => {
    const tree = toHast('---\ntitle: Notes\n\nBody.\n');
    expect(findElement(tree, 'hr')).toBeDefined();
    expect(JSON.stringify(tree)).toContain('title: Notes');
  });
});
