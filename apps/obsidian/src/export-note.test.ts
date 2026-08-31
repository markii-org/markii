import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { StoredValue } from '@markii/runtime';
import { createRegistry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { EMPTY_IMAGE_REPORT, MAX_EMBEDDED_IMAGE_BYTES } from '@markii/host';
import type {
  EmbeddedImageReport,
  ExportBodyRenderer,
  ExportImageReader,
  ExportRenderInfo,
} from '@markii/host';
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
  NoteExportRequest,
} from './export-note.js';
import { renderNoteBodyForExport } from './export/render-body.js';

/** The static-engine render info a request with no `renderBody` produces, for fixtures that don't care about it. */
const RENDER_STATIC_NO_PACKS: ExportRenderInfo = {
  engine: 'static',
  reason: 'no-packs',
};

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
  {
    kind: 'html',
    path: 'reports/week.html',
    valueCount: 0,
    render: RENDER_STATIC_NO_PACKS,
    images: EMPTY_IMAGE_REPORT,
  },
  {
    kind: 'html',
    path: 'reports/week.html',
    valueCount: 3,
    render: RENDER_STATIC_NO_PACKS,
    images: EMPTY_IMAGE_REPORT,
  },
  {
    kind: 'pdf',
    path: 'reports/week.pdf',
    valueCount: 3,
    render: { engine: 'react', packCount: 1, stylesheetCount: 1 },
    images: EMPTY_IMAGE_REPORT,
  },
  {
    kind: 'pdf-unavailable',
    path: 'reports/week.html',
    valueCount: 0,
    reason: 'no BrowserWindow here',
    render: RENDER_STATIC_NO_PACKS,
    images: EMPTY_IMAGE_REPORT,
  },
  {
    kind: 'pdf-failed',
    path: 'reports/week.html',
    valueCount: 0,
    reason: 'printToPDF timed out',
    render: {
      engine: 'static',
      reason: 'render-failed',
      detail: 'component exploded',
    },
    images: EMPTY_IMAGE_REPORT,
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
        render: RENDER_STATIC_NO_PACKS,
        images: EMPTY_IMAGE_REPORT,
      }),
    ).toContain('week.html');
    expect(
      exportNoticeText({
        kind: 'html',
        path: 'reports/week.html',
        valueCount: 2,
        render: RENDER_STATIC_NO_PACKS,
        images: EMPTY_IMAGE_REPORT,
      }),
    ).not.toContain('reports/');
  });

  it('keeps the value count out of the notice, where the two hosts now agree', () => {
    const text = exportNoticeText({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 4,
      hasScripts: true,
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(text).toContain('week.html');
    expect(text).not.toContain('4');
    expect(text).not.toContain('value');
  });

  it('still puts the count on the diagnostics surface', () => {
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 4,
      hasScripts: true,
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(lines[0]).toContain('4 stored values baked in');
  });

  it('says PDF is unavailable on this device and names the file written instead', () => {
    const text = exportNoticeText({
      kind: 'pdf-unavailable',
      path: 'reports/week.html',
      valueCount: 0,
      reason: 'no BrowserWindow here',
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
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
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(text).toContain('PDF export failed');
    expect(text).toContain('week.html');
    expect(text).not.toContain('timed out');
  });

  it('tells a user who has not run the note why the figures are missing', () => {
    expect(
      exportNoticeText({
        kind: 'html',
        path: 'week.html',
        valueCount: 0,
        hasScripts: true,
        render: RENDER_STATIC_NO_PACKS,
        images: EMPTY_IMAGE_REPORT,
      }),
    ).toContain('Run the note first');
  });

  it('never tells a scriptless note to run itself first', () => {
    const text = exportNoticeText({
      kind: 'html',
      path: 'week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(text).not.toContain('Run the note first');
    expect(text).toContain('sits beside the note');
  });

  it('gives the run hint on a PDF of a scripted, never-run note', () => {
    expect(
      exportNoticeText({
        kind: 'pdf',
        path: 'week.pdf',
        valueCount: 0,
        hasScripts: true,
        render: RENDER_STATIC_NO_PACKS,
        images: EMPTY_IMAGE_REPORT,
      }),
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
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
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
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(lines.join('\n')).toContain('print from there');
  });

  it('produces at least one line for every outcome', () => {
    for (const outcome of OUTCOMES) {
      expect(exportDiagnosticLines(outcome).length).toBeGreaterThan(0);
    }
  });

  it('describes a React render with the pack and stylesheet counts, pluralized', () => {
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: { engine: 'react', packCount: 1, stylesheetCount: 1 },
      images: EMPTY_IMAGE_REPORT,
    });
    expect(lines.join('\n')).toContain("preview's React engine");
    expect(lines.join('\n')).toContain('1 pack component');
    expect(lines.join('\n')).toContain('1 pack stylesheet');

    const pluralLines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: { engine: 'react', packCount: 2, stylesheetCount: 3 },
      images: EMPTY_IMAGE_REPORT,
    });
    expect(pluralLines.join('\n')).toContain('2 pack components');
    expect(pluralLines.join('\n')).toContain('3 pack stylesheets');
  });

  it('says a static render matches the preview when no packs are loaded', () => {
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    expect(lines.join('\n')).toContain('no pack components are loaded');
    expect(lines.join('\n')).toContain('matches the preview');
  });

  it('says a failed React render fell back and carries the verbatim detail', () => {
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: {
        engine: 'static',
        reason: 'render-failed',
        detail: 'component exploded',
      },
      images: EMPTY_IMAGE_REPORT,
    });
    expect(lines.join('\n')).toContain('React render failed');
    expect(lines.join('\n')).toContain('exported as labeled boxes');
    expect(lines.join('\n')).toContain('component exploded');
  });

  it('handles every StaticExportReason without throwing, including the unreachable ones', () => {
    const reasons: readonly ExportRenderInfo[] = [
      { engine: 'static', reason: 'no-packs' },
      { engine: 'static', reason: 'no-renderer' },
      { engine: 'static', reason: 'timeout' },
      { engine: 'static', reason: 'render-failed' },
    ];
    for (const render of reasons) {
      const lines = exportDiagnosticLines({
        kind: 'html',
        path: 'reports/week.html',
        valueCount: 0,
        render,
        images: EMPTY_IMAGE_REPORT,
      });
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('the new render line contains no em dash and no parentheses', () => {
    const renders: readonly ExportRenderInfo[] = [
      { engine: 'react', packCount: 2, stylesheetCount: 1 },
      { engine: 'static', reason: 'no-packs' },
      { engine: 'static', reason: 'no-renderer' },
      { engine: 'static', reason: 'timeout', detail: 'worker did not answer' },
      { engine: 'static', reason: 'render-failed', detail: 'boom' },
    ];
    for (const render of renders) {
      const lines = exportDiagnosticLines({
        kind: 'html',
        path: 'reports/week.html',
        valueCount: 0,
        render,
        images: EMPTY_IMAGE_REPORT,
      });
      const renderLine = lines[lines.length - 1]!;
      expect(renderLine).not.toContain('—');
      expect(renderLine).not.toMatch(/[()]/);
    }
  });

  it('adds an embedded-images line with the count and bytes added', () => {
    const images: EmbeddedImageReport = {
      embedded: ['pic.png', 'chart.png'],
      embeddedBytes: 51200,
      skipped: [],
      remote: 0,
    };
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images,
    });
    expect(lines.join('\n')).toContain('Embedded 2 images');
    expect(lines.join('\n')).toContain('50 KB');
  });

  it('names a too-large skip with its size', () => {
    const images: EmbeddedImageReport = {
      embedded: [],
      embeddedBytes: 0,
      skipped: [
        {
          src: 'assets/huge.png',
          reason: 'too-large',
          byteLength: 3 * 1024 * 1024,
        },
      ],
      remote: 0,
    };
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images,
    });
    expect(lines.join('\n')).toContain('huge.png');
    expect(lines.join('\n')).toContain('3.0 MB');
    // The embed limit itself, named in the same line.
    expect(MAX_EMBEDDED_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(lines.join('\n')).toContain('2.0 MB');
  });

  it('names an unsupported-type skip', () => {
    const images: EmbeddedImageReport = {
      embedded: [],
      embeddedBytes: 0,
      skipped: [{ src: 'assets/scan.tiff', reason: 'unsupported-type' }],
      remote: 0,
    };
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images,
    });
    expect(lines.join('\n')).toContain('scan.tiff');
    expect(lines.join('\n')).toContain('not embedded');
  });

  it('carries the verbatim detail for an unreadable skip', () => {
    const images: EmbeddedImageReport = {
      embedded: [],
      embeddedBytes: 0,
      skipped: [
        {
          src: 'assets/gone.png',
          reason: 'unreadable',
          detail: 'ENOENT no such file',
        },
      ],
      remote: 0,
    };
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images,
    });
    expect(lines.join('\n')).toContain('ENOENT no such file');
  });

  it('adds no image lines at all when a note has no local images', () => {
    const before = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    });
    // Exactly the export line and the render line, nothing about images.
    expect(before.length).toBe(2);
  });

  it('every new image diagnostics line contains no em dash and no parentheses', () => {
    const images: EmbeddedImageReport = {
      embedded: ['pic.png'],
      embeddedBytes: 2048,
      skipped: [
        { src: 'huge.png', reason: 'too-large', byteLength: 3 * 1024 * 1024 },
        { src: 'scan.tiff', reason: 'unsupported-type' },
        { src: 'gone.png', reason: 'unreadable', detail: 'not found' },
      ],
      remote: 1,
    };
    const lines = exportDiagnosticLines({
      kind: 'html',
      path: 'reports/week.html',
      valueCount: 0,
      render: RENDER_STATIC_NO_PACKS,
      images,
    });
    for (const line of lines) {
      expect(line).not.toContain('—');
      expect(line).not.toMatch(/[()]/);
    }
  });
});

describe('export-note.ts wiring against a fake pack registry', () => {
  it('classifies a request with no renderBody as the static engine', async () => {
    const { fs, text } = createFs();
    const outcome = await exportNoteAsHtml({ ...NOTE, fs });
    expect(outcome.kind).toBe('html');
    if (outcome.kind !== 'html') throw new Error('unreachable');
    expect(outcome.render).toEqual({ engine: 'static', reason: 'no-packs' });
    expect(text.has('reports/week 32.html')).toBe(true);
  });

  it('classifies a throwing renderBody as render-failed and still writes the static file', async () => {
    const { fs, text } = createFs();
    const renderBody: ExportBodyRenderer = () => {
      throw new Error('the renderer blew up');
    };
    const outcome = await exportNoteAsHtml({ ...NOTE, fs, renderBody });
    expect(outcome.kind).toBe('html');
    if (outcome.kind !== 'html') throw new Error('unreachable');
    expect(outcome.render).toMatchObject({
      engine: 'static',
      reason: 'render-failed',
      detail: 'the renderer blew up',
    });
    expect(text.get('reports/week 32.html')).toContain('<h1>Week 32</h1>');
  });

  it('renders through React with a fake pack component and embeds its CSS, not the unknown-component fallback', async () => {
    const { fs, text } = createFs();
    const registry = createRegistry({
      ...defaultRegistry,
      'ana-timeline': {
        component: () =>
          createElement(
            'div',
            { className: 'mk-ana_timeline' },
            'timeline component markup',
          ),
      },
    });
    const request: NoteExportRequest = {
      notePath: 'reports/timeline.mk.md',
      text: ':::ana-timeline\n:::\n',
      fs,
      renderBody: renderNoteBodyForExport(registry),
      packStylesheets: [
        { namespace: 'ana', cssText: '.mk-ana_timeline { color: red; }' },
      ],
      packCount: 1,
    };
    const outcome = await exportNoteAsHtml(request);
    expect(outcome.kind).toBe('html');
    if (outcome.kind !== 'html') throw new Error('unreachable');
    expect(outcome.render).toEqual({
      engine: 'react',
      packCount: 1,
      stylesheetCount: 1,
    });

    const written = text.get('reports/timeline.html') ?? '';
    expect(written).toContain('mk-ana_timeline');
    expect(written).toContain('timeline component markup');
    expect(written).toContain('.mk-ana_timeline { color: red; }');
    expect(written).not.toContain('unknown component');
  });

  it('threads an embedImages reader through to a data: URI and the outcome report', async () => {
    const { fs, text } = createFs();
    const embedImages: ExportImageReader = (src) => {
      if (src !== 'pic.png') {
        return { kind: 'unreadable', detail: 'not the expected source' };
      }
      return { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) };
    };
    const outcome = await exportNoteAsHtml({
      notePath: 'reports/pic.mk.md',
      text: '# Report\n\n![a picture](pic.png)\n',
      fs,
      embedImages,
    });
    expect(outcome.kind).toBe('html');
    if (outcome.kind !== 'html') throw new Error('unreachable');
    expect(outcome.images.embedded).toEqual(['pic.png']);
    expect(text.get('reports/pic.html')).toContain('data:image/png;base64,');
  });
});
