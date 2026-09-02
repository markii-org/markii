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

  it('carries the embedded doc.css dark-mode block, so a viewer with a dark OS preference gets a themed page', () => {
    const doc = exportHtmlDocument('body');
    expect(doc).toContain('prefers-color-scheme: dark');
  });

  it('sets no data-mk-theme attribute on the .doc wrapper, so an exported document keeps following the OS preference', () => {
    const doc = exportHtmlDocument('<p>hi</p>', {
      docClassName: 'mk-export--hide-scripts',
    });
    // doc.css's own selectors legitimately mention `data-mk-theme` (the
    // opt-out/forced-theme attribute a host may set), and that text living
    // in the embedded <style> block is expected. What must NOT happen is
    // the exported document's own `.doc` wrapper carrying that attribute.
    const bodyStart = doc.indexOf('<body>');
    expect(doc.slice(bodyStart)).not.toContain('data-mk-theme');
  });

  it('adds a docClassName alongside the doc class, leaving the default untouched when omitted', () => {
    const withoutClass = exportHtmlDocument('body');
    expect(withoutClass).toContain('<div class="doc">');

    const withClass = exportHtmlDocument('body', {
      docClassName: 'mk-export--hide-scripts',
    });
    expect(withClass).toContain('<div class="doc mk-export--hide-scripts">');
  });
});

describe('exportHtmlDocument: the exported page carries its own dark palette', () => {
  it('ships a dark palette, so an exported file follows the reader system setting', () => {
    const doc = exportHtmlDocument('<p>hi</p>');
    expect(doc).toContain('@media (prefers-color-scheme: dark)');
    const dark = doc.slice(doc.indexOf('@media (prefers-color-scheme: dark)'));
    expect(dark).toContain('--mk-bg:');
    expect(dark).toContain('--mk-fg:');
  });

  it('defines that palette exactly once, in doc.css, rather than again in the shell', () => {
    const doc = exportHtmlDocument('<p>hi</p>');
    const blocks = doc.match(/@media \(prefers-color-scheme: dark\)\s*\{/g);
    // Two palettes would mean two things to keep in step, with the later one
    // silently winning. doc.css already carries one for standalone files.
    expect(blocks).toHaveLength(1);
  });

  it('puts host extraCss last, so a host still wins over doc.css', () => {
    const doc = exportHtmlDocument('<p>hi</p>', {
      extraCss: '.doc { --mk-accent: hotpink; }',
    });
    expect(doc.indexOf('prefers-color-scheme: dark')).toBeLessThan(
      doc.indexOf('hotpink'),
    );
  });
});
