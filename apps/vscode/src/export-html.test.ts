import { describe, expect, it } from 'vitest';
import {
  EXPORT_HTML_FILTERS,
  EXPORT_HTML_NO_DOCUMENT_MESSAGE,
  EXPORT_HTML_REVEAL_LABEL,
  EXPORT_HTML_SAVE_DIALOG_TITLE,
  EXPORT_HTML_SAVE_LABEL,
  exportHtmlDefaultFileName,
  exportHtmlDiagnosticLines,
  exportHtmlResultMessage,
} from './export-html.js';
import type { HtmlExportOutcome } from './export-html.js';

describe('exportHtmlDefaultFileName', () => {
  it('names the export after the note', () => {
    expect(exportHtmlDefaultFileName('/w/notes/week.mk.md')).toBe('week.html');
  });

  it('handles a plain markdown note', () => {
    expect(exportHtmlDefaultFileName('/w/readme.md')).toBe('readme.html');
  });

  it('handles an untitled buffer path with no folder', () => {
    expect(exportHtmlDefaultFileName('Untitled-1')).toBe('Untitled-1.html');
  });
});

describe('exportHtmlResultMessage', () => {
  it('names the written file and the values baked into it', () => {
    const message = exportHtmlResultMessage({
      kind: 'written',
      path: '/w/notes/week.html',
      bytes: 1234,
      valueCount: 3,
    });
    expect(message).toContain('week.html');
    expect(message).toContain('3 script values');
    expect(message).not.toContain('/w/notes');
  });

  it('uses the singular for one value', () => {
    expect(
      exportHtmlResultMessage({
        kind: 'written',
        path: 'week.html',
        bytes: 10,
        valueCount: 1,
      }),
    ).toContain('with 1 script value from');
  });

  it('says so when nothing was baked in, rather than leaving empty states unexplained', () => {
    const message = exportHtmlResultMessage({
      kind: 'written',
      path: 'week.html',
      bytes: 10,
      valueCount: 0,
    });
    expect(message).toContain('no stored script values');
  });

  it('points a failure at the diagnostics surface and never carries the reason', () => {
    const message = exportHtmlResultMessage({
      kind: 'failed',
      path: '/w/notes/week.html',
      reason: 'EACCES: permission denied, open ...',
    });
    expect(message).toContain('Markii output');
    expect(message).not.toContain('EACCES');
  });
});

describe('exportHtmlDiagnosticLines', () => {
  it('records a success with its path, size, and value count', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/notes/week.html',
      bytes: 4096,
      valueCount: 2,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/w/notes/week.html');
    expect(lines[0]).toContain('4096');
    expect(lines[0]).toContain('2 stored values');
  });

  it('records a failure reason verbatim, which the popup omits', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'failed',
      path: '/w/notes/week.html',
      reason: 'EACCES: permission denied',
    });
    expect(lines[0]).toContain('EACCES: permission denied');
    expect(lines[0]).toContain('/w/notes/week.html');
  });

  it('records a failure that never reached a path', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'failed',
      reason: 'the document was closed',
    });
    expect(lines[0]).toContain('the document was closed');
  });
});

describe('export wording', () => {
  const outcomes: HtmlExportOutcome[] = [
    { kind: 'written', path: '/w/week.html', bytes: 10, valueCount: 0 },
    { kind: 'written', path: '/w/week.html', bytes: 10, valueCount: 1 },
    { kind: 'written', path: '/w/week.html', bytes: 10, valueCount: 5 },
    { kind: 'failed', path: '/w/week.html', reason: 'nope' },
    { kind: 'failed', reason: 'nope' },
  ];
  const allStrings = [
    EXPORT_HTML_NO_DOCUMENT_MESSAGE,
    EXPORT_HTML_SAVE_DIALOG_TITLE,
    EXPORT_HTML_SAVE_LABEL,
    EXPORT_HTML_REVEAL_LABEL,
    ...outcomes.map(exportHtmlResultMessage),
    ...outcomes.flatMap(exportHtmlDiagnosticLines),
  ];

  it('contains no em dash', () => {
    for (const value of allStrings) {
      expect(value).not.toContain('—');
    }
  });

  it('contains no parentheses', () => {
    for (const value of allStrings) {
      expect(value).not.toMatch(/[()]/);
    }
  });

  it('prefixes every message the user sees with the product name', () => {
    expect(EXPORT_HTML_NO_DOCUMENT_MESSAGE.startsWith('Markii')).toBe(true);
    for (const outcome of outcomes) {
      expect(exportHtmlResultMessage(outcome).startsWith('Markii: ')).toBe(
        true,
      );
    }
  });
});

describe('EXPORT_HTML_FILTERS', () => {
  it('defaults the picker to HTML files', () => {
    expect(EXPORT_HTML_FILTERS.HTML).toEqual(['html', 'htm']);
  });
});
