import { parse } from '@markii/core';
import { describe, expect, it } from 'vitest';
import {
  buildDirectiveListing,
  createDocViewSource,
  DEFAULT_DOC_LISTING_LIMITS,
  laterScriptReadMessage,
  sanitizeText,
  utf8ByteLength,
  type DirectiveEntry,
} from './doc';

function listingFor(text: string, overrides = {}) {
  return buildDirectiveListing(parse(text), overrides);
}

function names(entries: readonly DirectiveEntry[]): string[] {
  return entries.map((entry) => entry.name);
}

describe('buildDirectiveListing — what it lists', () => {
  it('lists the three directive forms with the form each was written in', () => {
    const listing = listingFor(
      [
        ':::card{title="A"}',
        'inside',
        ':::',
        '',
        '::badge[Beta]{tone=info}',
        '',
        'A :kbd[Ctrl]{} key.',
      ].join('\n'),
    );
    expect(listing.directives.map((d) => [d.name, d.form])).toEqual([
      ['card', 'container'],
      ['badge', 'leaf'],
      ['kbd', 'inline'],
    ]);
    expect(listing.truncated).toBe(false);
  });

  it('keeps document order and lists a nested directive right after its parent', () => {
    const listing = listingFor(
      [
        '::::outer{}',
        'lead',
        '',
        ':::inner{}',
        'nested',
        ':::',
        '::::',
        '',
        '::after{}',
      ].join('\n'),
    );
    expect(names(listing.directives)).toEqual(['outer', 'inner', 'after']);
  });

  it('reads attributes as strings, with a bare attribute as an empty string', () => {
    const listing = listingFor('::stat{data=repo label="Stars" compact}');
    expect(listing.directives[0]?.attributes).toEqual({
      data: 'repo',
      label: 'Stars',
      compact: '',
    });
  });

  it('strips markdown from the text and joins blocks with a newline', () => {
    const listing = listingFor(
      [
        ':::q{}',
        'A **bold** claim with `code` and a [link](https://example.com).',
        '',
        'Second paragraph.',
        ':::',
      ].join('\n'),
    );
    expect(listing.directives[0]?.text).toBe(
      'A bold claim with code and a link.\nSecond paragraph.',
    );
  });

  it("includes a nested directive's text inside its parent, and again on its own", () => {
    const listing = listingFor(
      ['::::outer{}', 'lead', '', ':::inner{}', 'nested', ':::', '::::'].join(
        '\n',
      ),
    );
    expect(listing.directives[0]?.text).toBe('lead\nnested');
    expect(listing.directives[1]?.text).toBe('nested');
  });

  it('lists nothing for a note with no directives, and never throws on a non-tree', () => {
    expect(listingFor('# Just a heading\n\nSome text.')).toEqual({
      directives: [],
      truncated: false,
    });
    expect(buildDirectiveListing(undefined)).toEqual({
      directives: [],
      truncated: false,
    });
    expect(buildDirectiveListing(null)).toEqual({
      directives: [],
      truncated: false,
    });
    expect(
      buildDirectiveListing({ type: 'root', children: 'nope' } as never),
    ).toEqual({ directives: [], truncated: false });
  });

  it('lists a directive inside a blockquote or a list item', () => {
    const listing = listingFor(
      ['> ::inquote{}', '', '- ::inlist{}'].join('\n'),
    );
    expect(names(listing.directives)).toEqual(['inquote', 'inlist']);
  });
});

describe('buildDirectiveListing — hostile content', () => {
  it('treats a prototype-flavored attribute name as an ordinary key', () => {
    // What the parser hands over: `constructor` survives as an own key,
    // `__proto__` never becomes one (see conformance/10-prototype-names).
    const parsed = listingFor('::x{__proto__=polluted constructor=also}');
    expect(parsed.directives[0]?.attributes).toEqual({ constructor: 'also' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // And what the builder does with an own `__proto__` key regardless,
    // since the tree is an input this package does not itself produce.
    const attributes: Record<string, string> = {};
    Object.defineProperty(attributes, '__proto__', {
      value: 'polluted',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const listing = buildDirectiveListing({
      type: 'root',
      children: [{ type: 'leafDirective', name: 'x', attributes }],
    });
    const built = listing.directives[0]?.attributes ?? {};
    expect(Object.getPrototypeOf(built)).toBeNull();
    expect(Object.hasOwn(built, '__proto__')).toBe(true);
    expect(Object.keys(built)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops NUL and other control characters from text and attribute values', () => {
    const listing = buildDirectiveListing({
      type: 'root',
      children: [
        {
          type: 'leafDirective',
          name: 'x',
          attributes: { a: 'be\u0000fore\u0007' },
          children: [{ type: 'text', value: 'te\u0000xt\u001b' }],
        },
      ],
    });
    expect(listing.directives[0]?.text).toBe('text');
    expect(listing.directives[0]?.attributes.a).toBe('before');
  });

  it('replaces an unpaired surrogate and keeps a real astral character whole', () => {
    expect(sanitizeText('a\ud800b')).toBe('a\uFFFDb');
    expect(sanitizeText('a\udc00b')).toBe('a\uFFFDb');
    expect(sanitizeText('a\u{1F600}b')).toBe('a\u{1F600}b');
    expect(utf8ByteLength('\u{1F600}')).toBe(4);
    expect(utf8ByteLength('aé中')).toBe(1 + 2 + 3);
  });

  it('caps one directive text and reports the listing as truncated', () => {
    const listing = listingFor(
      [':::big{}', 'x'.repeat(5_000), ':::'].join('\n'),
      { maxTextBytes: 100 },
    );
    expect(listing.directives[0]?.text).toHaveLength(100);
    expect(listing.truncated).toBe(true);
  });

  it('never cuts a multi-byte character in half when capping text', () => {
    const listing = buildDirectiveListing(
      {
        type: 'root',
        children: [
          {
            type: 'leafDirective',
            name: 'x',
            children: [{ type: 'text', value: '\u{1F600}'.repeat(10) }],
          },
        ],
      },
      { maxTextBytes: 10 },
    );
    // 10 bytes fits two 4-byte emoji, not two and a half.
    expect(listing.directives[0]?.text).toBe('\u{1F600}\u{1F600}');
    expect(listing.truncated).toBe(true);
  });

  it('caps the number of attributes and the length of one value', () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 50; i++) attributes[`a${i}`] = 'v';
    attributes.long = 'y'.repeat(5_000);
    const listing = buildDirectiveListing(
      {
        type: 'root',
        children: [{ type: 'leafDirective', name: 'x', attributes }],
      },
      { maxAttributes: 8, maxAttributeValueBytes: 16 },
    );
    expect(Object.keys(listing.directives[0]?.attributes ?? {})).toHaveLength(
      8,
    );
    expect(listing.truncated).toBe(true);
  });

  it('drops an attribute whose NAME is longer than the cap rather than cutting it', () => {
    const listing = buildDirectiveListing(
      {
        type: 'root',
        children: [
          {
            type: 'leafDirective',
            name: 'x',
            attributes: { ['n'.repeat(200)]: 'v', ok: 'v' },
          },
        ],
      },
      { maxAttributeNameBytes: 32 },
    );
    expect(Object.keys(listing.directives[0]?.attributes ?? {})).toEqual([
      'ok',
    ]);
    expect(listing.truncated).toBe(true);
  });

  it('stops at the directive count cap and says so', () => {
    const many = Array.from({ length: 40 }, (_, i) => `::d${i}{}`).join('\n\n');
    const listing = listingFor(many, { maxDirectives: 10 });
    expect(listing.directives).toHaveLength(10);
    expect(listing.truncated).toBe(true);
  });

  it('stops at the total byte budget and returns what fit, never throwing', () => {
    const block = [':::d{}', 'y'.repeat(400), ':::'].join('\n');
    const listing = listingFor(
      Array.from({ length: 30 }, () => block).join('\n\n'),
      {
        maxTotalBytes: 2_000,
      },
    );
    expect(listing.directives.length).toBeGreaterThan(0);
    expect(listing.directives.length).toBeLessThan(30);
    expect(listing.truncated).toBe(true);
  });

  it('stops walking past the depth cap instead of recursing without bound', () => {
    let node: unknown = { type: 'leafDirective', name: 'deep' };
    for (let i = 0; i < 300; i++) {
      node = { type: 'blockquote', children: [node] };
    }
    const listing = buildDirectiveListing(
      { type: 'root', children: [node] } as never,
      { maxDepth: 50 },
    );
    expect(listing.directives).toEqual([]);
    expect(listing.truncated).toBe(true);
  });

  it('ignores an mdast-flavored node whose attributes are an array', () => {
    const listing = buildDirectiveListing({
      type: 'root',
      children: [
        {
          type: 'leafDirective',
          name: 'x',
          attributes: [{ type: 'mdxJsxAttribute', name: 'a', value: 'b' }],
        },
      ],
    });
    expect(listing.directives[0]?.attributes).toEqual({});
  });

  it('skips a directive node with no usable name', () => {
    const listing = buildDirectiveListing({
      type: 'root',
      children: [
        { type: 'leafDirective', name: null },
        { type: 'leafDirective', name: '\u0000' },
        { type: 'leafDirective', name: 'kept' },
      ],
    });
    expect(names(listing.directives)).toEqual(['kept']);
  });

  it('exposes only the four documented fields per entry', () => {
    const listing = listingFor('::x{a=1}');
    expect(Object.keys(listing.directives[0] ?? {}).sort()).toEqual([
      'attributes',
      'form',
      'name',
      'text',
    ]);
  });
});

describe('the default caps', () => {
  it('are the documented numbers', () => {
    expect(DEFAULT_DOC_LISTING_LIMITS).toEqual({
      maxTotalBytes: 512 * 1024,
      maxDirectives: 2_000,
      maxTextBytes: 8 * 1024,
      maxAttributes: 32,
      maxAttributeNameBytes: 128,
      maxAttributeValueBytes: 1024,
      maxDepth: 200,
    });
  });

  it('leave an ordinary note untouched', () => {
    const note = Array.from(
      { length: 30 },
      (_, i) => `:::q{n=${i}}\nAnswer ${i}.\n:::`,
    ).join('\n\n');
    const listing = listingFor(note);
    expect(listing.directives).toHaveLength(30);
    expect(listing.truncated).toBe(false);
  });
});

describe('createDocViewSource — which values a script may read', () => {
  const listing = { directives: [], truncated: false };

  it('reads a value a script above already produced', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['first', 'second'],
    });
    source.recordCompleted('first', { n: 1 });
    expect(source.viewFor(1).value('first')).toEqual({
      ok: true,
      value: { n: 1 },
    });
  });

  it('refuses a script that runs later, with the one shared sentence', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['first', 'second'],
    });
    expect(source.viewFor(0).value('second')).toEqual({
      ok: false,
      message: laterScriptReadMessage('second'),
    });
    expect(laterScriptReadMessage('second')).toBe(
      'reads "second", which runs later in the note',
    );
  });

  it('refuses a script reading its own name', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['solo'],
    });
    expect(source.viewFor(0).value('solo')).toEqual({
      ok: false,
      message: laterScriptReadMessage('solo'),
    });
  });

  it('answers nil for a name no script in the note carries', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['first'],
    });
    expect(source.viewFor(0).value('nothing')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('answers nil for a script above that failed', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['broken', 'reader'],
    });
    source.recordCompleted('broken', undefined);
    expect(source.viewFor(1).value('broken')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('lets a duplicate name read the run that already finished above it', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['twice', 'reader', 'twice'],
    });
    source.recordCompleted('twice', 'first run');
    expect(source.viewFor(1).value('twice')).toEqual({
      ok: true,
      value: 'first run',
    });
  });

  it('treats a script named __proto__ as an ordinary name', () => {
    const source = createDocViewSource({
      directives: listing,
      scriptNames: ['__proto__', 'reader'],
    });
    expect(source.viewFor(1).value('__proto__')).toEqual({
      ok: true,
      value: undefined,
    });
    source.recordCompleted('__proto__', 7);
    expect(source.viewFor(1).value('__proto__')).toEqual({
      ok: true,
      value: 7,
    });
    expect(source.viewFor(1).value('constructor')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(source.viewFor(1).value('toString')).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
