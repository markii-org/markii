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
import type { ExportRenderInfo } from '@markii/host';

const STATIC_NO_PACKS: ExportRenderInfo = {
  engine: 'static',
  reason: 'no-packs',
};
const REACT_RENDER: ExportRenderInfo = {
  engine: 'react',
  packCount: 2,
  stylesheetCount: 1,
};

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
      render: STATIC_NO_PACKS,
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
        render: STATIC_NO_PACKS,
      }),
    ).toContain('with 1 script value from');
  });

  it('says so when nothing was baked in, rather than leaving empty states unexplained', () => {
    const message = exportHtmlResultMessage({
      kind: 'written',
      path: 'week.html',
      bytes: 10,
      valueCount: 0,
      render: STATIC_NO_PACKS,
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
      render: STATIC_NO_PACKS,
    });
    expect(lines).toHaveLength(2);
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

  it('describes a React render with its pack and stylesheet counts', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: REACT_RENDER,
    });
    expect(lines[1]).toContain("preview's React engine");
    expect(lines[1]).toContain('2 packs');
    expect(lines[1]).toContain('1 stylesheet');
  });

  it('describes a React render with singular counts', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: { engine: 'react', packCount: 1, stylesheetCount: 1 },
    });
    expect(lines[1]).toContain('1 pack');
    expect(lines[1]).toContain('1 stylesheet');
    expect(lines[1]).not.toContain('1 packs');
  });

  it('describes the no-packs static fallback as matching the preview', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: STATIC_NO_PACKS,
    });
    expect(lines[1]).toContain('no pack components are loaded');
    expect(lines[1]).toContain('matches what the preview shows');
  });

  it('describes the no-renderer static fallback and tells the user how to get packs included', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: { engine: 'static', reason: 'no-renderer' },
    });
    expect(lines[1]).toContain('no preview panel was open');
    expect(lines[1]).toContain('labeled boxes');
    expect(lines[1]).toContain('open the preview and export again');
  });

  it('describes a timeout fallback with the verbatim detail', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: {
        engine: 'static',
        reason: 'timeout',
        detail: 'no reply within 4000ms',
      },
    });
    expect(lines[1]).toContain('did not answer in time');
    expect(lines[1]).toContain('no reply within 4000ms');
  });

  it('describes a render-failed fallback with the verbatim detail', () => {
    const lines = exportHtmlDiagnosticLines({
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: {
        engine: 'static',
        reason: 'render-failed',
        detail: 'component threw',
      },
    });
    expect(lines[1]).toContain('could not render the note');
    expect(lines[1]).toContain('component threw');
  });
});

describe('export wording', () => {
  const outcomes: HtmlExportOutcome[] = [
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: STATIC_NO_PACKS,
    },
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 1,
      render: REACT_RENDER,
    },
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 5,
      render: { engine: 'react', packCount: 1, stylesheetCount: 1 },
    },
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: { engine: 'static', reason: 'no-renderer' },
    },
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: { engine: 'static', reason: 'timeout', detail: 'no reply' },
    },
    {
      kind: 'written',
      path: '/w/week.html',
      bytes: 10,
      valueCount: 0,
      render: {
        engine: 'static',
        reason: 'render-failed',
        detail: 'threw an error',
      },
    },
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
