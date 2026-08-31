import { describe, expect, it } from 'vitest';
import type { StoredValue } from '@markii/runtime';
import {
  HtmlToPdfUnavailableError,
  NO_ACTIVE_NOTE_NOTICE,
  exportDiagnosticLines,
  exportNoteAsHtml,
  exportNoteAsPdf,
  exportNoticeText,
  isPdfUnavailable,
} from './export-note.js';
import type {
  HtmlToPdf,
  NoteExportFs,
  NoteExportOutcome,
} from './export-note.js';

/** An in-memory `NoteExportFs` that records every write, and can be told to fail. */
function createFs(options: { failText?: boolean; failBinary?: boolean } = {}): {
  fs: NoteExportFs;
  text: Map<string, string>;
  binary: Map<string, Uint8Array>;
} {
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const fs: NoteExportFs = {
    writeText(path, contents) {
      if (options.failText) return Promise.reject(new Error('disk is full'));
      text.set(path, contents);
      return Promise.resolve();
    },
    writeBinary(path, data) {
      if (options.failBinary) return Promise.reject(new Error('disk is full'));
      binary.set(path, data);
      return Promise.resolve();
    },
  };
  return { fs, text, binary };
}

const NOTE = {
  notePath: 'reports/week 32.mk.md',
  text: '# Week 32\n\nTotal: :value[total]\n',
};

const VALUES: Record<string, StoredValue> = {
  total: { value: 42, status: 'fresh' },
};

/** An `HtmlToPdf` that returns recognizable bytes and records what it was given. */
function createPrinter(): { htmlToPdf: HtmlToPdf; seen: string[] } {
  const seen: string[] = [];
  const htmlToPdf: HtmlToPdf = (request) => {
    seen.push(request.html);
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  return { htmlToPdf, seen };
}

describe('exportNoteAsHtml', () => {
  it('writes one self-contained file beside the note', async () => {
    const { fs, text } = createFs();
    const outcome = await exportNoteAsHtml({ ...NOTE, values: VALUES, fs });

    expect(outcome).toMatchObject({
      kind: 'html',
      path: 'reports/week 32.html',
      valueCount: 1,
    });
    const written = text.get('reports/week 32.html') ?? '';
    expect(written.startsWith('<!doctype html>')).toBe(true);
    expect(written).toContain('<title>week 32</title>');
    expect(written).toContain('<h1>Week 32</h1>');
    // The shared stylesheet is embedded, so the file needs nothing beside it.
    expect(written).toContain('.mk-callout');
  });

  it('bakes in the last run values', async () => {
    const { fs, text } = createFs();
    await exportNoteAsHtml({ ...NOTE, values: VALUES, fs });
    expect(text.get('reports/week 32.html')).toContain('42');
  });

  it('exports a never-run note with its empty states and reports zero values', async () => {
    const { fs, text } = createFs();
    const outcome = await exportNoteAsHtml({ ...NOTE, fs });
    expect(outcome).toMatchObject({ kind: 'html', valueCount: 0 });
    expect(text.get('reports/week 32.html')).toContain('mk-value--missing');
  });

  it('reports a write failure without throwing', async () => {
    const { fs } = createFs({ failText: true });
    const outcome = await exportNoteAsHtml({ ...NOTE, fs });
    expect(outcome).toEqual({ kind: 'failed', reason: 'disk is full' });
  });
});

describe('exportNoteAsPdf', () => {
  it('writes the PDF beside the note, printed from the same document', async () => {
    const { fs, binary, text } = createFs();
    const { htmlToPdf, seen } = createPrinter();
    const outcome = await exportNoteAsPdf({
      ...NOTE,
      values: VALUES,
      fs,
      htmlToPdf,
      baseDir: '/vault/reports',
    });

    expect(outcome).toMatchObject({
      kind: 'pdf',
      path: 'reports/week 32.pdf',
      valueCount: 1,
    });
    expect(binary.get('reports/week 32.pdf')).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    // Only the PDF: a successful print leaves no HTML file behind.
    expect(text.size).toBe(0);
    expect(seen[0]).toContain('<h1>Week 32</h1>');
  });

  it('passes the note folder to the printer so relative images resolve', async () => {
    const { fs } = createFs();
    let baseDir: string | undefined = 'unset';
    const htmlToPdf: HtmlToPdf = (request) => {
      baseDir = request.baseDir;
      return Promise.resolve(new Uint8Array([1]));
    };
    await exportNoteAsPdf({
      ...NOTE,
      fs,
      htmlToPdf,
      baseDir: '/vault/reports',
    });
    expect(baseDir).toBe('/vault/reports');
  });

  it('falls back to writing HTML when this device cannot print at all', async () => {
    const { fs, text, binary } = createFs();
    const htmlToPdf: HtmlToPdf = () =>
      Promise.reject(new HtmlToPdfUnavailableError('no BrowserWindow here'));

    const outcome = await exportNoteAsPdf({
      ...NOTE,
      values: VALUES,
      fs,
      htmlToPdf,
      baseDir: undefined,
    });

    expect(outcome).toMatchObject({
      kind: 'pdf-unavailable',
      path: 'reports/week 32.html',
      valueCount: 1,
      reason: 'no BrowserWindow here',
    });
    expect(text.get('reports/week 32.html')).toContain('<h1>Week 32</h1>');
    expect(binary.size).toBe(0);
  });

  it('falls back to writing HTML when printing throws for any other reason', async () => {
    const { fs, text } = createFs();
    const htmlToPdf: HtmlToPdf = () =>
      Promise.reject(new Error('printToPDF timed out'));

    const outcome = await exportNoteAsPdf({
      ...NOTE,
      fs,
      htmlToPdf,
      baseDir: '/vault/reports',
    });

    expect(outcome).toMatchObject({
      kind: 'pdf-failed',
      path: 'reports/week 32.html',
      reason: 'printToPDF timed out',
    });
    expect(text.has('reports/week 32.html')).toBe(true);
  });

  it('treats a thrown non-Error as a printing failure rather than crashing', async () => {
    const { fs } = createFs();
    const htmlToPdf: HtmlToPdf = () => Promise.reject('nope');
    const outcome = await exportNoteAsPdf({
      ...NOTE,
      fs,
      htmlToPdf,
      baseDir: '/vault/reports',
    });
    expect(outcome.kind).toBe('pdf-failed');
  });

  it('reports an outright failure only when the HTML fallback also fails', async () => {
    const { fs } = createFs({ failText: true });
    const htmlToPdf: HtmlToPdf = () =>
      Promise.reject(new HtmlToPdfUnavailableError('no BrowserWindow here'));

    const outcome = await exportNoteAsPdf({
      ...NOTE,
      fs,
      htmlToPdf,
      baseDir: undefined,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');
    expect(outcome.reason).toContain('no BrowserWindow here');
    expect(outcome.reason).toContain('disk is full');
  });

  it('reports a failure when the PDF bytes cannot be written', async () => {
    const { fs, text } = createFs({ failBinary: true });
    const { htmlToPdf } = createPrinter();
    const outcome = await exportNoteAsPdf({
      ...NOTE,
      fs,
      htmlToPdf,
      baseDir: '/vault/reports',
    });
    // The write failed after printing, so the command still leaves the user
    // with the HTML file rather than nothing.
    expect(outcome.kind).toBe('pdf-failed');
    expect(text.has('reports/week 32.html')).toBe(true);
  });
});

describe('isPdfUnavailable', () => {
  it('recognizes the unavailable error', () => {
    expect(isPdfUnavailable(new HtmlToPdfUnavailableError('x'))).toBe(true);
  });

  it('recognizes the structural marker across a module boundary', () => {
    expect(isPdfUnavailable({ markiiPdfUnavailable: true })).toBe(true);
  });

  it('does not mistake an ordinary failure for unavailability', () => {
    expect(isPdfUnavailable(new Error('printToPDF timed out'))).toBe(false);
    expect(isPdfUnavailable(undefined)).toBe(false);
    expect(isPdfUnavailable('markiiPdfUnavailable')).toBe(false);
  });
});

const OUTCOMES: NoteExportOutcome[] = [
  { kind: 'html', path: 'reports/week.html', valueCount: 0 },
  { kind: 'html', path: 'reports/week.html', valueCount: 3 },
  { kind: 'pdf', path: 'reports/week.pdf', valueCount: 3 },
  {
    kind: 'pdf-unavailable',
    path: 'reports/week.html',
    valueCount: 0,
    reason: 'no BrowserWindow here',
  },
  {
    kind: 'pdf-failed',
    path: 'reports/week.html',
    valueCount: 0,
    reason: 'printToPDF timed out',
  },
  { kind: 'failed', reason: 'disk is full' },
];

describe('exportNoticeText', () => {
  it('names the written file rather than its full path', () => {
    expect(
      exportNoticeText({
        kind: 'html',
        path: 'reports/week.html',
        valueCount: 2,
      }),
    ).toContain('week.html');
    expect(
      exportNoticeText({
        kind: 'html',
        path: 'reports/week.html',
        valueCount: 2,
      }),
    ).not.toContain('reports/');
  });

  it('says PDF is unavailable on this device and names the file written instead', () => {
    const text = exportNoticeText({
      kind: 'pdf-unavailable',
      path: 'reports/week.html',
      valueCount: 0,
      reason: 'no BrowserWindow here',
    });
    expect(text).toContain('not available on this device');
    expect(text).toContain('week.html');
    expect(text).not.toContain('no BrowserWindow here');
  });

  it('distinguishes a printing failure from an unavailable device', () => {
    const text = exportNoticeText({
      kind: 'pdf-failed',
      path: 'reports/week.html',
      valueCount: 0,
      reason: 'printToPDF timed out',
    });
    expect(text).toContain('PDF export failed');
    expect(text).toContain('week.html');
    expect(text).not.toContain('timed out');
  });

  it('tells a user who has not run the note why the figures are missing', () => {
    expect(
      exportNoticeText({ kind: 'html', path: 'week.html', valueCount: 0 }),
    ).toContain('Run the note first');
  });

  it('points an outright failure at the diagnostics surface', () => {
    const text = exportNoticeText({ kind: 'failed', reason: 'disk is full' });
    expect(text).toContain('Markii diagnostics');
    expect(text).not.toContain('disk is full');
  });
});

describe('export wording', () => {
  const allStrings = [NO_ACTIVE_NOTE_NOTICE, ...OUTCOMES.map(exportNoticeText)];

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

  it('is at most two short sentences', () => {
    for (const value of allStrings) {
      const sentences = value.split('. ').filter((part) => part.length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
    }
  });

  it('names the product in every notice', () => {
    for (const value of allStrings) {
      expect(value.startsWith('Markii: ')).toBe(true);
    }
  });
});

describe('exportDiagnosticLines', () => {
  it('records a failure reason verbatim, which the notice omits', () => {
    const lines = exportDiagnosticLines({
      kind: 'pdf-failed',
      path: 'reports/week.html',
      valueCount: 0,
      reason: 'printToPDF timed out',
    });
    expect(lines.join('\n')).toContain('printToPDF timed out');
    expect(lines.join('\n')).toContain('reports/week.html');
  });

  it('tells the user how to get a PDF when this device cannot print', () => {
    const lines = exportDiagnosticLines({
      kind: 'pdf-unavailable',
      path: 'reports/week.html',
      valueCount: 0,
      reason: 'no BrowserWindow here',
    });
    expect(lines.join('\n')).toContain('print from there');
  });

  it('produces at least one line for every outcome', () => {
    for (const outcome of OUTCOMES) {
      expect(exportDiagnosticLines(outcome).length).toBeGreaterThan(0);
    }
  });
});
