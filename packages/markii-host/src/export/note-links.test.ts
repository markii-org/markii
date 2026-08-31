import { describe, expect, it } from 'vitest';
import {
  extractNoteLinks,
  isLocalNoteTarget,
  maskCodeRegions,
  rewriteNoteLinks,
} from './note-links.js';

/** The link targets of `text`, in order, for the many cases that only care about those. */
function targets(text: string): string[] {
  return extractNoteLinks(text).map((link) => link.path);
}

describe('isLocalNoteTarget', () => {
  it('accepts a note name or a relative path', () => {
    expect(isLocalNoteTarget('Other note')).toBe(true);
    expect(isLocalNoteTarget('sub/other.md')).toBe(true);
    expect(isLocalNoteTarget('../other.mk.md')).toBe(true);
  });

  it('rejects a URL, a protocol-relative source, and a bare fragment', () => {
    expect(isLocalNoteTarget('https://example.com/x')).toBe(false);
    expect(isLocalNoteTarget('mailto:a@b.c')).toBe(false);
    expect(isLocalNoteTarget('//cdn/x')).toBe(false);
    expect(isLocalNoteTarget('#section')).toBe(false);
    expect(isLocalNoteTarget('')).toBe(false);
  });
});

describe('maskCodeRegions', () => {
  it('keeps the text the same length so offsets stay valid', () => {
    const text = 'a `code` b\n```\nfenced\n```\nc\n';
    expect(maskCodeRegions(text)).toHaveLength(text.length);
  });

  it('preserves newlines', () => {
    const text = '```\nfenced\n```\n';
    expect(maskCodeRegions(text).split('\n')).toHaveLength(
      text.split('\n').length,
    );
  });

  it('leaves ordinary prose untouched', () => {
    expect(maskCodeRegions('plain [[link]] text')).toBe('plain [[link]] text');
  });

  it('masks an unclosed fence to the end of the note', () => {
    const masked = maskCodeRegions('```\n[[a]]\n');
    expect(masked).not.toContain('[[a]]');
  });
});

describe('extractNoteLinks', () => {
  it('finds a plain wikilink', () => {
    expect(targets('see [[Other note]] here')).toEqual(['Other note']);
  });

  it('reads a wikilink alias as the label', () => {
    const [link] = extractNoteLinks('[[Other note|what I call it]]');
    expect(link?.path).toBe('Other note');
    expect(link?.label).toBe('what I call it');
  });

  it('splits a heading or block fragment off the path', () => {
    const [heading] = extractNoteLinks('[[Other#A heading]]');
    expect(heading?.path).toBe('Other');
    expect(heading?.fragment).toBe('#A heading');
    const [block] = extractNoteLinks('[[Other^abc123]]');
    expect(block?.path).toBe('Other');
    expect(block?.fragment).toBe('^abc123');
  });

  it('finds a markdown link', () => {
    expect(targets('see [the note](sub/other.md) here')).toEqual([
      'sub/other.md',
    ]);
  });

  it('decodes percent escapes in a markdown target', () => {
    expect(targets('[a](My%20Note.md)')).toEqual(['My Note.md']);
  });

  it('reads an angle-bracketed markdown target', () => {
    expect(targets('[a](<My Note.md>)')).toEqual(['My Note.md']);
  });

  it('ignores a markdown title', () => {
    expect(targets('[a](other.md "the title")')).toEqual(['other.md']);
  });

  it('ignores embeds and images', () => {
    expect(targets('![[Some note]]')).toEqual([]);
    expect(targets('![alt](nice.png)')).toEqual([]);
  });

  it('ignores external links', () => {
    expect(
      targets('[a](https://example.com) [[//cdn/x]] [b](mailto:a@b.c)'),
    ).toEqual([]);
  });

  it('ignores a bare fragment link', () => {
    expect(targets('[jump](#section)')).toEqual([]);
  });

  it('never reads link syntax inside a fenced code block', () => {
    expect(targets('```\n[[Other note]]\n[a](b.md)\n```\n')).toEqual([]);
  });

  it('never reads link syntax inside an inline code span', () => {
    expect(targets('write `[[Other note]]` to link')).toEqual([]);
  });

  it('still reads a real link on the same line as a code span', () => {
    expect(targets('`[[fake]]` but [[Real note]] counts')).toEqual([
      'Real note',
    ]);
  });

  it('never reads link syntax inside a Markii script fence', () => {
    expect(targets('```lua {name=x}\n-- [[Other note]]\n```\n')).toEqual([]);
  });

  it('returns links in document order across both syntaxes', () => {
    expect(targets('[a](one.md) then [[Two]] then [b](three.md)')).toEqual([
      'one.md',
      'Two',
      'three.md',
    ]);
  });

  it('reports offsets that index the original text', () => {
    const text = 'x [[Other]] y';
    const [link] = extractNoteLinks(text);
    expect(text.slice(link?.start, link?.end)).toBe('[[Other]]');
  });
});

describe('rewriteNoteLinks', () => {
  const toHtml = (name: string) => (): string | undefined => `${name}.html`;

  it('changes a markdown link destination and nothing else', () => {
    expect(rewriteNoteLinks('see [the note](other.md).', toHtml('other'))).toBe(
      'see [the note](other.html).',
    );
  });

  it('turns a wikilink into a markdown link so the export is navigable', () => {
    expect(rewriteNoteLinks('see [[Other note]].', toHtml('Other note'))).toBe(
      'see [Other note](Other%20note.html).',
    );
  });

  it('keeps a wikilink alias as the link text', () => {
    expect(
      rewriteNoteLinks('[[Other note|what I call it]]', toHtml('other')),
    ).toBe('[what I call it](other.html)');
  });

  it('keeps a fragment on the rewritten destination', () => {
    expect(rewriteNoteLinks('[[Other#A heading]]', toHtml('other'))).toBe(
      '[Other#A heading](other.html#A heading)',
    );
  });

  it('leaves every link the resolver declines exactly as written', () => {
    const text = 'see [[Kept]] and [also](kept.md) and [x](https://y.z)';
    expect(rewriteNoteLinks(text, () => undefined)).toBe(text);
  });

  it('rewrites several links in one pass without disturbing offsets', () => {
    const text = '[[A]] middle [b](b.md) end';
    const result = rewriteNoteLinks(text, (link) =>
      link.path === 'A' ? 'a.html' : 'b.html',
    );
    expect(result).toBe('[A](a.html) middle [b](b.html) end');
  });

  it('never rewrites inside code', () => {
    const text = '`[[A]]` and [[A]]';
    expect(rewriteNoteLinks(text, toHtml('a'))).toBe('`[[A]]` and [A](a.html)');
  });

  it('escapes a label bracket that would otherwise break the link', () => {
    expect(rewriteNoteLinks('[[Note|a [b c]]', toHtml('note'))).toBe(
      '[a \\[b c](note.html)',
    );
  });

  it('does not match a wikilink whose alias closes a bracket, rather than guessing', () => {
    const text = '[[Note|a [b] c]]';
    expect(extractNoteLinks(text)).toEqual([]);
    expect(rewriteNoteLinks(text, toHtml('note'))).toBe(text);
  });
});
