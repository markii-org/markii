import { describe, expect, it } from 'vitest';
import {
  EXPORT_HTML_FILTERS,
  EXPORT_HTML_NO_DOCUMENT_MESSAGE,
  EXPORT_HTML_REVEAL_LABEL,
  EXPORT_HTML_SAVE_DIALOG_TITLE,
  EXPORT_HTML_SAVE_LABEL,
} from './export-html.js';
import type { ExportImageReader } from '@markii/host';
import { composeNoteHtmlExport, embedImagesInHtml } from '@markii/host';

// The exported file's default name, the outcome shape, the result
// message, and every diagnostics-line builder (`exportDefaultFileName`,
// `NoteFileExportOutcome`, `exportResultMessage`, `renderEngineDiagnosticLine`,
// `imageEmbedDiagnosticLines`, `exportDiagnosticLines`) moved to
// `@markii/host` (batch 11) and are covered there by
// `packages/markii-host/src/host/export-behavior.test.ts`. What remains
// worth testing here is this extension's own UI constants (the save
// dialog's title, labels, and filter) and the image-embedding pipeline
// wiring below.

describe('export UI wording', () => {
  const allStrings = [
    EXPORT_HTML_NO_DOCUMENT_MESSAGE,
    EXPORT_HTML_SAVE_DIALOG_TITLE,
    EXPORT_HTML_SAVE_LABEL,
    EXPORT_HTML_REVEAL_LABEL,
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

  it('prefixes the no-document message with the product name', () => {
    expect(EXPORT_HTML_NO_DOCUMENT_MESSAGE.startsWith('Markii')).toBe(true);
  });
});

describe('EXPORT_HTML_FILTERS', () => {
  it('defaults the picker to HTML files', () => {
    expect(EXPORT_HTML_FILTERS.HTML).toEqual(['html', 'htm']);
  });
});

describe('image embedding pipeline', () => {
  it('lands a local image as a data URI in the finished export document', async () => {
    const PIXEL = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const reader: ExportImageReader = (src) =>
      src === 'nice.png'
        ? { kind: 'bytes', bytes: PIXEL }
        : { kind: 'unreadable', detail: 'not stubbed' };

    const body = '<p>note</p><img src="nice.png" alt="">';
    const { html: embeddedBody, report } = await embedImagesInHtml(
      body,
      reader,
    );
    expect(report.embedded).toEqual(['nice.png']);

    const document = composeNoteHtmlExport({
      bodyHtml: embeddedBody,
      fileName: 'week.mk.md',
    });
    expect(document).toContain('src="data:image/png;base64,');
    expect(document).not.toContain('src="nice.png"');
  });
});
