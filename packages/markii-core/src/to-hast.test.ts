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
