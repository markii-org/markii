import { describe, expect, it } from 'vitest';
import {
  convertNoteWikilinks,
  convertWikilinksToMarkdown,
  markdownForWikilink,
} from './wikilinks.js';
import type { WikilinkReference } from './wikilinks.js';

describe('markdownForWikilink', () => {
  it('renders a plain wikilink as an ordinary markdown link', () => {
    const reference: WikilinkReference = {
      link: 'Some Note',
      isEmbed: false,
      offset: { start: 0, end: 11 },
    };
    expect(markdownForWikilink(reference, 'Some Note.md')).toBe(
      '[Some Note](Some Note.md)',
    );
  });

  it('prefers displayText for [[Page|Alias]]', () => {
    const reference: WikilinkReference = {
      link: 'Some Note',
      displayText: 'Alias',
      isEmbed: false,
      offset: { start: 0, end: 20 },
    };
    expect(markdownForWikilink(reference, 'Some Note.md')).toBe(
      '[Alias](Some Note.md)',
    );
  });

  it('renders an embed as a markdown image', () => {
    const reference: WikilinkReference = {
      link: 'image.png',
      isEmbed: true,
      offset: { start: 0, end: 13 },
    };
    expect(markdownForWikilink(reference, 'image.png')).toBe(
      '![image.png](image.png)',
    );
  });
});

describe('convertWikilinksToMarkdown', () => {
  it('replaces a single wikilink in place', () => {
    const text = 'See [[Some Note]] for details.';
    const start = text.indexOf('[[Some Note]]');
    const end = start + '[[Some Note]]'.length;
    const references: WikilinkReference[] = [
      { link: 'Some Note', isEmbed: false, offset: { start, end } },
    ];

    const result = convertWikilinksToMarkdown(
      text,
      references,
      (link) => `${link}.md`,
    );

    expect(result).toBe('See [Some Note](Some Note.md) for details.');
  });

  it('replaces multiple references without shifting earlier offsets (descending-offset splice)', () => {
    const text = '[[A]] and ![[b.png]] and [[C|see C]]';
    const references: WikilinkReference[] = [
      { link: 'A', isEmbed: false, offset: { start: 0, end: 5 } },
      { link: 'b.png', isEmbed: true, offset: { start: 10, end: 20 } },
      {
        link: 'C',
        displayText: 'see C',
        isEmbed: false,
        offset: { start: 25, end: 36 },
      },
    ];

    const result = convertWikilinksToMarkdown(text, references, (link) => link);

    expect(result).toBe('[A](A) and ![b.png](b.png) and [see C](C)');
  });

  it('leaves an unresolved wikilink pointing at its own raw text', () => {
    const text = '[[Missing Note]]';
    const references: WikilinkReference[] = [
      { link: 'Missing Note', isEmbed: false, offset: { start: 0, end: 16 } },
    ];

    const result = convertWikilinksToMarkdown(
      text,
      references,
      () => 'Missing Note',
    );

    expect(result).toBe('[Missing Note](Missing Note)');
  });

  it('skips a reference whose offsets no longer fit the text, rather than corrupting it', () => {
    const text = 'short';
    const references: WikilinkReference[] = [
      { link: 'stale', isEmbed: false, offset: { start: 10, end: 20 } },
    ];

    const result = convertWikilinksToMarkdown(text, references, (l) => l);

    expect(result).toBe('short');
  });

  it('is a no-op with no references', () => {
    const text = 'nothing to convert here';
    expect(convertWikilinksToMarkdown(text, [], (l) => l)).toBe(text);
  });
});

describe('convertNoteWikilinks', () => {
  it('converts the links and embeds of one note from its metadata cache', () => {
    const text = 'see [[Guide]] and ![[shot.png]]';
    const cache = {
      links: [
        {
          link: 'Guide',
          position: { start: { offset: 4 }, end: { offset: 13 } },
        },
      ],
      embeds: [
        {
          link: 'shot.png',
          position: { start: { offset: 18 }, end: { offset: 31 } },
        },
      ],
    };

    const result = convertNoteWikilinks(text, cache, (link) =>
      link === 'shot.png' ? 'assets/shot.png' : 'notes/Guide.md',
    );

    expect(result).toBe(
      'see [Guide](notes/Guide.md) and ![shot.png](assets/shot.png)',
    );
  });

  it('keeps an unresolved link pointing at its own raw text', () => {
    const text = '[[Missing]]';
    const cache = {
      links: [
        {
          link: 'Missing',
          position: { start: { offset: 0 }, end: { offset: 11 } },
        },
      ],
    };

    expect(convertNoteWikilinks(text, cache, () => undefined)).toBe(
      '[Missing](Missing)',
    );
  });

  it('is a no-op when the host has no cache for the note yet', () => {
    expect(convertNoteWikilinks('plain [[text]]', null, () => 'x')).toBe(
      'plain [[text]]',
    );
  });
});
