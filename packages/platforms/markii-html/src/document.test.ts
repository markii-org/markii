import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from './render.js';
import { defaultHtmlRegistry } from './components/index.js';
import { exportHtmlDocument } from './document.js';

describe('exportHtmlDocument', () => {
  it('produces a well-formed, self-contained document', () => {
    const doc = exportHtmlDocument('<p>hello</p>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<html lang="en">');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<title>Markii document</title>');
    expect(doc).toContain('<style>');
    expect(doc).toContain('</style>');
    expect(doc).toContain('<div class="doc">');
    expect(doc).toContain('<p>hello</p>');
    expect(doc.trim().endsWith('</html>')).toBe(true);
  });

  it('embeds the real shared doc.css, not a placeholder', () => {
    const doc = exportHtmlDocument('body');
    // A handful of selectors that only exist in the real stylesheet.
    expect(doc).toContain('.doc > * + *');
    expect(doc).toContain('.mk-callout');
    expect(doc).toContain('.mk-stat__value');
  });

  it('escapes a custom title and lang, but never re-escapes the body', () => {
    const doc = exportHtmlDocument('<p>already &amp; safe</p>', {
      title: '<script>alert(1)</script>',
      lang: '"><script>',
    });
    expect(doc).not.toContain('<script>alert(1)</script>');
    expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(doc).toContain('lang="&quot;&gt;&lt;script&gt;"');
    // The body's own escaping (already done by renderMarkToHtml) survives
    // unchanged — no double-escaping of its "&amp;".
    expect(doc).toContain('<p>already &amp; safe</p>');
    expect(doc).not.toContain('&amp;amp;');
  });

  it('appends extraCss verbatim after doc.css', () => {
    const doc = exportHtmlDocument('body', {
      extraCss: '.custom { color: red; }',
    });
    const styleStart = doc.indexOf('<style>');
    const styleEnd = doc.indexOf('</style>');
    const styleBlock = doc.slice(styleStart, styleEnd);
    expect(styleBlock).toContain('.doc > * + *');
    expect(styleBlock).toContain('.custom { color: red; }');
    expect(styleBlock.indexOf('.doc > * + *')).toBeLessThan(
      styleBlock.indexOf('.custom'),
    );
  });

  it('wraps a real rendered document end to end, producing a document a browser could open', () => {
    const body = renderMarkToHtml(
      '# Title\n\n:::callout{type=warning}\nHeads up\n:::\n',
      defaultHtmlRegistry,
    );
    const doc = exportHtmlDocument(body, { title: 'My note' });
    expect(doc).toContain('<title>My note</title>');
    expect(doc).toContain('<h1>Title</h1>');
    expect(doc).toContain('mk-callout--warning');
  });
});
