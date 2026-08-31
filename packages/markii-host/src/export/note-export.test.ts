import { describe, expect, it } from 'vitest';
import type { StoredValue } from '@markii/runtime';
import {
  EXPORT_PAGE_CSS,
  FALLBACK_EXPORT_BASE_NAME,
  buildNoteHtmlExport,
  exportBaseName,
  exportDocumentTitle,
  exportedFileName,
  exportedSiblingPath,
} from './note-export.js';

describe('exportBaseName', () => {
  it('drops a .mk.md extension', () => {
    expect(exportBaseName('notes.mk.md')).toBe('notes');
  });

  it('drops a plain .md extension', () => {
    expect(exportBaseName('notes.md')).toBe('notes');
  });

  it('is case-insensitive about the extension', () => {
    expect(exportBaseName('Notes.MK.MD')).toBe('Notes');
  });

  it('keeps an unrecognized extension rather than guessing', () => {
    expect(exportBaseName('notes.txt')).toBe('notes.txt');
  });

  it('reads only the last segment of a path', () => {
    expect(exportBaseName('reports/2026/week.mk.md')).toBe('week');
  });

  it('falls back when there is no base name at all', () => {
    expect(exportBaseName('.mk.md')).toBe(FALLBACK_EXPORT_BASE_NAME);
    expect(exportBaseName('')).toBe(FALLBACK_EXPORT_BASE_NAME);
    expect(exportBaseName('folder/')).toBe(FALLBACK_EXPORT_BASE_NAME);
  });

  it('keeps a dotted name that is not an extension we know', () => {
    expect(exportBaseName('2026.01.notes.mk.md')).toBe('2026.01.notes');
  });
});

describe('exportedFileName', () => {
  it('builds the html and pdf names', () => {
    expect(exportedFileName('notes.mk.md', '.html')).toBe('notes.html');
    expect(exportedFileName('notes.mk.md', '.pdf')).toBe('notes.pdf');
  });
});

describe('exportedSiblingPath', () => {
  it('keeps the note folder', () => {
    expect(exportedSiblingPath('reports/2026/week.mk.md', '.html')).toBe(
      'reports/2026/week.html',
    );
  });

  it('handles a note at the root', () => {
    expect(exportedSiblingPath('week.mk.md', '.pdf')).toBe('week.pdf');
  });

  it('handles an absolute-looking path', () => {
    expect(exportedSiblingPath('/home/me/week.mk.md', '.html')).toBe(
      '/home/me/week.html',
    );
  });
});

describe('exportDocumentTitle', () => {
  it('titles the document after the note, not the format', () => {
    expect(exportDocumentTitle('reports/week 32.mk.md')).toBe('week 32');
  });
});

describe('EXPORT_PAGE_CSS', () => {
  it('supplies the page around doc.css: a ground, a measure, and print rules', () => {
    expect(EXPORT_PAGE_CSS).toContain('body {');
    expect(EXPORT_PAGE_CSS).toContain('max-width');
    expect(EXPORT_PAGE_CSS).toContain('@media print');
  });

  it('never claims :root, the same politeness rule doc.css follows', () => {
    expect(EXPORT_PAGE_CSS).not.toContain(':root');
  });
});

describe('buildNoteHtmlExport', () => {
  it('produces a self-contained document with the shared stylesheet embedded', () => {
    const html = buildNoteHtmlExport({
      text: '# Hello\n\nSome text.\n',
      fileName: 'notes.mk.md',
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>notes</title>');
    expect(html).toContain('<div class="doc">');
    expect(html).toContain('<h1>Hello</h1>');
    // The real doc.css, not a placeholder.
    expect(html).toContain('.doc > * + *');
    expect(html).toContain('.mk-callout');
    // And the page CSS this module adds on top of it.
    expect(html).toContain('@media print');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('renders a standard component through the static engine', () => {
    const html = buildNoteHtmlExport({
      text: ':::callout{type=warning}\nHeads up\n:::\n',
      fileName: 'notes.mk.md',
    });
    expect(html).toContain('mk-callout');
    expect(html).toContain('Heads up');
  });

  it('bakes in the last run values a note binds', () => {
    const values: Record<string, StoredValue> = {
      total: { value: 42, status: 'fresh' },
    };
    const html = buildNoteHtmlExport({
      text: 'Total: :value[total]\n',
      fileName: 'notes.mk.md',
      values,
    });
    expect(html).toContain('42');
    expect(html).not.toContain('{total}');
  });

  it('shows the standard empty state for a note that has never been run', () => {
    const html = buildNoteHtmlExport({
      text: 'Total: :value[total]\n',
      fileName: 'notes.mk.md',
    });
    expect(html).toContain('mk-value--missing');
    expect(html).toContain('{total}');
  });

  it('falls back cleanly for a pack component the static engine cannot load', () => {
    const html = buildNoteHtmlExport({
      text: ':::ana_timeline{from=2024}\nInner **markdown**\n:::\n',
      fileName: 'notes.mk.md',
    });
    expect(html).toContain('mk-unknown');
    expect(html).toContain('unknown component');
    expect(html).toContain('ana_timeline');
    // The author's own content is still there, never dropped.
    expect(html).toContain('<strong>markdown</strong>');
  });

  it('appends a host extraCss after the page CSS', () => {
    const html = buildNoteHtmlExport({
      text: 'hi\n',
      fileName: 'notes.mk.md',
      extraCss: '.custom { color: red; }',
    });
    expect(html).toContain('.custom { color: red; }');
    expect(html.indexOf('@media print')).toBeLessThan(
      html.indexOf('.custom { color: red; }'),
    );
  });

  it('escapes a hostile note title rather than emitting it as markup', () => {
    const html = buildNoteHtmlExport({
      text: 'hi\n',
      // No slash in the name: a path separator would be split off as a
      // folder before the title is ever built, which is a different rule.
      fileName: '<script>alert(1)<x>.mk.md',
    });
    expect(html).not.toContain('<title><script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;x&gt;');
  });
});
