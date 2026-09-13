import { describe, expect, it } from 'vitest';
import { buildNoteHtmlExport } from '@markii/host';
import { exportHtml, mdPlainFromSource } from './export-note.js';

describe('exportHtml', () => {
  it('matches buildNoteHtmlExport byte for byte for the same input', () => {
    const text = '# Hello\n\nSome *text*.\n';
    const fileName = 'note.mk.md';
    expect(exportHtml(text, fileName)).toBe(
      buildNoteHtmlExport({ text, fileName }),
    );
  });

  it('matches buildNoteHtmlExport when values are supplied', () => {
    const text = ':value[greeting]\n';
    const fileName = 'note.mk.md';
    const values = {
      greeting: { value: 'hi', status: 'fresh' as const },
    };
    expect(exportHtml(text, fileName, values)).toBe(
      buildNoteHtmlExport({ text, fileName, values }),
    );
  });
});

describe('mdPlainFromSource', () => {
  it('strips container fences, a leaf directive, a text directive, a nested container, and a script fence', () => {
    const text = [
      '::::callout{type=info title="Nested"}',
      'Outer text with :kbd[Enter] inline.',
      '',
      '::rating{value=4 max=5}',
      '',
      ':::callout{type=warning title="Inner"}',
      'Inner content.',
      ':::',
      '::::',
      '',
      '```lua {name=x}',
      'return 1',
      '```',
      '',
      'Trailing paragraph.',
      '',
    ].join('\n');

    const expected =
      'Outer text with Enter inline.\n\nInner content.\n\nTrailing paragraph.\n';

    expect(mdPlainFromSource(text)).toBe(expected);
  });

  it('collapses the blank-line run a removed directive leaves behind', () => {
    // Cutting the directive out leaves the blank line that preceded it and
    // the one that followed it adjacent; CommonMark reads any run of blank
    // lines as one break, so closing them up keeps the file readable
    // without changing how it parses.
    expect(mdPlainFromSource('A.\n\n::divider\n\n::divider\n\nB.\n')).toBe(
      'A.\n\nB.\n',
    );
  });

  it('leaves plain markdown with no directives untouched', () => {
    const text = '# Title\n\nJust a *paragraph* with no directives.\n';
    expect(mdPlainFromSource(text)).toBe(text);
  });

  it('removes an empty leaf directive entirely', () => {
    const text = 'Before.\n\n::divider\n\nAfter.\n';
    expect(mdPlainFromSource(text)).toBe('Before.\n\nAfter.\n');
  });

  it('removes a named script fence but leaves an unnamed code fence alone', () => {
    const text = [
      '```lua {name=compute}',
      'return 1',
      '```',
      '',
      '```js',
      'console.log(1);',
      '```',
      '',
    ].join('\n');
    const expected = ['```js', 'console.log(1);', '```', ''].join('\n');
    expect(mdPlainFromSource(text)).toBe(expected);
  });
});
