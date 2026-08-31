import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  rewriteCascadeLinks,
  walkNoteCascade,
} from './cascade.js';
import type { CascadeLinkResolver } from './cascade.js';
import { zipExportArchive } from './export-zip.js';

/**
 * A vault fake: notes keyed by path, links resolved by matching a target
 * against a path or its base name, the way an Obsidian vault resolves a
 * bare note name from anywhere.
 */
function vault(notes: Record<string, string>): {
  readNote: (path: string) => string | undefined;
  resolveLink: CascadeLinkResolver;
} {
  const paths = Object.keys(notes);
  return {
    readNote: (path) => notes[path],
    resolveLink: (link) => {
      if (Object.prototype.hasOwnProperty.call(notes, link.path)) {
        return link.path;
      }
      return paths.find((path) => {
        const fileName = path.slice(path.lastIndexOf('/') + 1);
        return (
          fileName === link.path ||
          fileName === `${link.path}.mk.md` ||
          fileName === `${link.path}.md`
        );
      });
    },
  };
}

describe('walkNoteCascade', () => {
  it('returns the root note alone when it links to nothing', async () => {
    const { readNote, resolveLink } = vault({ 'a.mk.md': 'just text' });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
    });
    expect(result.notes.map((note) => note.path)).toEqual(['a.mk.md']);
    expect(result.truncated).toBeUndefined();
  });

  it('follows wikilinks and markdown links transitively', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': 'see [[b]] and [c](c.mk.md)',
      'b.mk.md': 'links on to [[d]]',
      'c.mk.md': 'a leaf',
      'd.mk.md': 'another leaf',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
    });
    expect(result.notes.map((note) => note.path)).toEqual([
      'a.mk.md',
      'b.mk.md',
      'c.mk.md',
      'd.mk.md',
    ]);
    expect(result.notes.map((note) => note.depth)).toEqual([0, 1, 1, 2]);
  });

  it('terminates on a cycle rather than walking forever', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': '[[b]]',
      'b.mk.md': '[[c]]',
      'c.mk.md': '[[a]] and [[b]]',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
    });
    expect(result.notes.map((note) => note.path)).toEqual([
      'a.mk.md',
      'b.mk.md',
      'c.mk.md',
    ]);
  });

  it('reads each note exactly once', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': '[[b]] [[c]]',
      'b.mk.md': '[[c]]',
      'c.mk.md': '[[b]]',
    });
    const read = vi.fn(readNote);
    await walkNoteCascade({ rootPath: 'a.mk.md', readNote: read, resolveLink });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops at the depth limit and says so', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': '[[b]]',
      'b.mk.md': '[[c]]',
      'c.mk.md': '[[d]]',
      'd.mk.md': 'leaf',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
      maxDepth: 2,
    });
    expect(result.notes.map((note) => note.path)).toEqual([
      'a.mk.md',
      'b.mk.md',
      'c.mk.md',
    ]);
    expect(result.truncated).toBe('depth');
  });

  it('does not claim truncation when the last ring simply has no links', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': '[[b]]',
      'b.mk.md': 'leaf',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
      maxDepth: 1,
    });
    expect(result.truncated).toBeUndefined();
  });

  it('stops at the note-count limit and says so', async () => {
    const notes: Record<string, string> = {
      'root.mk.md': '[[a]] [[b]] [[c]] [[d]]',
    };
    for (const name of ['a', 'b', 'c', 'd']) notes[`${name}.mk.md`] = 'leaf';
    const { readNote, resolveLink } = vault(notes);
    const result = await walkNoteCascade({
      rootPath: 'root.mk.md',
      readNote,
      resolveLink,
      maxNotes: 3,
    });
    expect(result.notes).toHaveLength(3);
    expect(result.truncated).toBe('count');
  });

  it('records a note it could not read and carries on', async () => {
    const { resolveLink } = vault({
      'a.mk.md': '[[b]] [[c]]',
      'b.mk.md': 'x',
      'c.mk.md': 'y',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote: (path) =>
        path === 'b.mk.md'
          ? undefined
          : path === 'a.mk.md'
            ? '[[b]] [[c]]'
            : 'y',
      resolveLink,
    });
    expect(result.notes.map((note) => note.path)).toEqual([
      'a.mk.md',
      'c.mk.md',
    ]);
    expect(result.unreadable).toEqual([{ path: 'b.mk.md', from: 'a.mk.md' }]);
  });

  it('treats a reader that throws as unreadable rather than failing the walk', async () => {
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote: (path) => {
        if (path === 'a.mk.md') return '[[b]]';
        throw new Error('EACCES');
      },
      resolveLink: (link) => `${link.path}.mk.md`,
    });
    expect(result.notes.map((note) => note.path)).toEqual(['a.mk.md']);
    expect(result.unreadable).toEqual([{ path: 'b.mk.md', from: 'a.mk.md' }]);
  });

  it('reports an unreadable root as nothing to export', async () => {
    const result = await walkNoteCascade({
      rootPath: 'gone.mk.md',
      readNote: () => undefined,
      resolveLink: () => undefined,
    });
    expect(result.notes).toEqual([]);
    expect(result.unreadable).toEqual([{ path: 'gone.mk.md', from: '' }]);
  });

  it('never follows a link into code', async () => {
    const { readNote, resolveLink } = vault({
      'a.mk.md': '```\n[[b]]\n```\n',
      'b.mk.md': 'leaf',
    });
    const result = await walkNoteCascade({
      rootPath: 'a.mk.md',
      readNote,
      resolveLink,
    });
    expect(result.notes.map((note) => note.path)).toEqual(['a.mk.md']);
  });

  it('ships defaults that bound an unbounded vault', () => {
    expect(DEFAULT_CASCADE_MAX_DEPTH).toBeGreaterThan(0);
    expect(DEFAULT_CASCADE_MAX_NOTES).toBeGreaterThan(0);
  });
});

describe('assignCascadeFileNames', () => {
  it('names each note after itself', () => {
    const names = assignCascadeFileNames(['reports/week.mk.md', 'index.md']);
    expect(names.get('reports/week.mk.md')).toBe('week.html');
    expect(names.get('index.md')).toBe('index.html');
  });

  it('keeps the first claim and suffixes later ones for a flat archive', () => {
    const names = assignCascadeFileNames([
      'a/note.mk.md',
      'b/note.mk.md',
      'c/note.mk.md',
    ]);
    expect([...names.values()]).toEqual([
      'note.html',
      'note-2.html',
      'note-3.html',
    ]);
  });

  it('treats names that differ only by case as colliding, for case-insensitive filesystems', () => {
    const names = assignCascadeFileNames(['a/Note.mk.md', 'b/note.mk.md']);
    expect([...names.values()]).toEqual(['Note.html', 'note-2.html']);
  });
});

describe('rewriteCascadeLinks', () => {
  const resolveLink: CascadeLinkResolver = (link) =>
    link.path === 'outside' ? 'outside.mk.md' : `${link.path}.mk.md`;

  it('points a link at the sibling exported file', () => {
    const names = new Map([['b.mk.md', 'b.html']]);
    const text = rewriteCascadeLinks(
      { path: 'a.mk.md', text: 'see [[b]]', depth: 0 },
      names,
      resolveLink,
    );
    expect(text).toBe('see [b](b.html)');
  });

  it('leaves a link to a note outside the cascade exactly as written', () => {
    const text = rewriteCascadeLinks(
      {
        path: 'a.mk.md',
        text: 'see [[outside]] and [x](https://y.z)',
        depth: 0,
      },
      new Map(),
      resolveLink,
    );
    expect(text).toBe('see [[outside]] and [x](https://y.z)');
  });
});

describe('zipExportArchive', () => {
  it('produces a zip a reader can recognize', () => {
    const bytes = zipExportArchive([{ name: 'a.html', text: '<p>a</p>' }]);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('is byte-identical for the same input, so a re-export is diffable', () => {
    const entries = [
      { name: 'a.html', text: '<p>a</p>' },
      { name: 'b.html', text: '<p>b</p>' },
    ];
    expect(zipExportArchive(entries)).toEqual(zipExportArchive(entries));
  });

  it('carries every entry', () => {
    const bytes = zipExportArchive([
      { name: 'one.html', text: 'x' },
      { name: 'two.html', text: 'y' },
    ]);
    const asText = new TextDecoder('latin1').decode(bytes);
    expect(asText).toContain('one.html');
    expect(asText).toContain('two.html');
  });
});
