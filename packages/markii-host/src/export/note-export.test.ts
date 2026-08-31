import { describe, expect, it } from 'vitest';
import type { StoredValue } from '@markii/runtime';
import {
  EXPORT_PAGE_CSS,
  FALLBACK_EXPORT_BASE_NAME,
  buildNoteExport,
  buildNoteHtmlExport,
  composeNoteHtmlExport,
  exportBaseName,
  exportDocumentTitle,
  exportedFileName,
  exportedSiblingPath,
  packStylesheetsCss,
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

describe('packStylesheetsCss', () => {
  it('keeps the host load order and labels each block with its pack', () => {
    const css = packStylesheetsCss([
      { namespace: 'ana', cssText: '.ana-timeline { color: red; }' },
      { namespace: 'bee', cssText: '.bee-chip { color: blue; }' },
    ]);
    expect(css.indexOf('ana-timeline')).toBeLessThan(css.indexOf('bee-chip'));
    expect(css).toContain('/* pack: ana */');
    expect(css).toContain('/* pack: bee */');
  });

  it('is empty for no packs, so the shell gains nothing', () => {
    expect(packStylesheetsCss([])).toBe('');
  });

  it('neutralizes a stray closing style tag rather than letting it end the block', () => {
    const css = packStylesheetsCss([
      {
        namespace: 'ana',
        cssText: '.a { content: "</style><script>x</script>"; }',
      },
    ]);
    expect(css).not.toContain('</style>');
    expect(css).toContain('<\\/style>');
  });

  it('cannot be escaped through the comment label', () => {
    const css = packStylesheetsCss([
      {
        namespace: 'a*/ body { display: none } /*',
        cssText: '.a { color: red; }',
      },
    ]);
    expect(css).toContain('/* pack: abodydisplaynone */');
    expect(css.split('/*').length).toBe(css.split('*/').length);
  });
});

describe('composeNoteHtmlExport', () => {
  it('embeds the body inside the shared doc shell', () => {
    const html = composeNoteHtmlExport({
      bodyHtml: '<p>hello</p>',
      fileName: 'week.mk.md',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>week</title>');
    expect(html).toContain('<div class="doc">');
    expect(html).toContain('<p>hello</p>');
  });

  it('places pack CSS after doc.css and the page CSS, per the pack load order', () => {
    const html = composeNoteHtmlExport({
      bodyHtml: '<p>hello</p>',
      fileName: 'week.mk.md',
      packStylesheets: [
        { namespace: 'ana', cssText: '.ana-x { color: red; }' },
      ],
    });
    expect(html.indexOf('--mk-')).toBeLessThan(html.indexOf('.ana-x'));
    expect(html.indexOf('@media print')).toBeLessThan(html.indexOf('.ana-x'));
    expect(html.indexOf('.ana-x')).toBeLessThan(html.indexOf('</style>'));
  });

  it('puts host extra CSS before the pack stylesheets', () => {
    const html = composeNoteHtmlExport({
      bodyHtml: '',
      fileName: 'week.mk.md',
      extraCss: '.host-layer { color: green; }',
      packStylesheets: [
        { namespace: 'ana', cssText: '.ana-x { color: red; }' },
      ],
    });
    expect(html.indexOf('.host-layer')).toBeLessThan(html.indexOf('.ana-x'));
  });

  it('leaves exactly one style block, even with hostile pack CSS', () => {
    const html = composeNoteHtmlExport({
      bodyHtml: '',
      fileName: 'week.mk.md',
      packStylesheets: [
        { namespace: 'ana', cssText: '.a { content: "</StYlE>"; }' },
      ],
    });
    expect(html.split('</style>').length - 1).toBe(1);
  });
});

describe('buildNoteExport', () => {
  const text =
    ':::callout{tone="info"}\nhi\n:::\n\n:::ana-timeline\nfrom a pack\n:::\n';

  it('renders through the host renderer and embeds the pack CSS', async () => {
    const result = await buildNoteExport({
      text,
      fileName: 'week.mk.md',
      renderBody: () => ({
        ok: true,
        html: '<div class="ana-timeline">from a pack</div>',
      }),
      packStylesheets: [
        { namespace: 'ana', cssText: '.ana-timeline { color: red; }' },
      ],
      packCount: 1,
    });
    expect(result.render).toEqual({
      engine: 'react',
      packCount: 1,
      stylesheetCount: 1,
    });
    expect(result.html).toContain(
      '<div class="ana-timeline">from a pack</div>',
    );
    expect(result.html).toContain('.ana-timeline { color: red; }');
    expect(result.html).not.toContain('unknown component');
  });

  it('hands the renderer the note text and its values', async () => {
    const seen: { text?: string; values?: Record<string, StoredValue> } = {};
    await buildNoteExport({
      text: 'body',
      fileName: 'week.mk.md',
      values: { total: { value: 3, status: 'fresh' } },
      renderBody: (givenText, givenValues) => {
        seen.text = givenText;
        seen.values = givenValues;
        return { ok: true, html: '<p>3</p>' };
      },
    });
    expect(seen.text).toBe('body');
    expect(seen.values).toEqual({ total: { value: 3, status: 'fresh' } });
  });

  it('counts the values it baked in', async () => {
    const result = await buildNoteExport({
      text: 'body',
      fileName: 'week.mk.md',
      values: {
        a: { value: 1, status: 'fresh' },
        b: { value: 2, status: 'fresh' },
      },
      renderBody: () => ({ ok: true, html: '<p>x</p>' }),
    });
    expect(result.valueCount).toBe(2);
  });

  it('falls back to the static engine when no renderer is offered', async () => {
    const result = await buildNoteExport({ text, fileName: 'week.mk.md' });
    expect(result.render).toEqual({ engine: 'static', reason: 'no-packs' });
    expect(result.html).toContain('unknown component');
  });

  it('keeps the caller reason for a host with no renderer at all', async () => {
    const result = await buildNoteExport({
      text,
      fileName: 'week.mk.md',
      staticReason: 'no-renderer',
    });
    expect(result.render).toEqual({ engine: 'static', reason: 'no-renderer' });
  });

  it('classifies a renderer that reports a timeout', async () => {
    const result = await buildNoteExport({
      text,
      fileName: 'week.mk.md',
      renderBody: () => ({
        ok: false,
        reason: 'timeout',
        detail: 'no answer in 4000 ms',
      }),
      packStylesheets: [
        { namespace: 'ana', cssText: '.ana-timeline { color: red; }' },
      ],
    });
    expect(result.render).toEqual({
      engine: 'static',
      reason: 'timeout',
      detail: 'no answer in 4000 ms',
    });
    // The static body never references pack CSS, so none is embedded.
    expect(result.html).not.toContain('.ana-timeline { color: red; }');
    expect(result.html).toContain('unknown component');
  });

  it('classifies a renderer that throws, rather than propagating', async () => {
    const result = await buildNoteExport({
      text,
      fileName: 'week.mk.md',
      renderBody: () => {
        throw new Error('registry exploded');
      },
    });
    expect(result.render).toEqual({
      engine: 'static',
      reason: 'render-failed',
      detail: 'registry exploded',
    });
    expect(result.html).toContain('<!doctype html>');
  });

  it('produces the same document as the slice 1 builder on every static path', async () => {
    const result = await buildNoteExport({ text, fileName: 'week.mk.md' });
    expect(result.html).toBe(
      buildNoteHtmlExport({ text, fileName: 'week.mk.md' }),
    );
  });
});
