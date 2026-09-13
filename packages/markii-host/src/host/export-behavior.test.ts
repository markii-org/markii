import { describe, expect, it } from 'vitest';
import type { ExportRenderInfo } from '../export/note-export.js';
import { EMPTY_IMAGE_REPORT } from '../export/image-embed.js';
import { EXPORT_HIDE_SCRIPT_BLOCKS_CLASS } from '../export/note-export.js';
import type { EmbeddedImageReport } from '../export/image-embed.js';
import {
  buildExportDocument,
  exportDefaultFileName,
  exportDiagnosticLines,
  exportNoteFileViaAdapter,
  exportResultMessage,
  fileNameOf,
  imageEmbedDiagnosticLines,
  renderEngineDiagnosticLine,
} from './export-behavior.js';
import type { NoteFileExportOutcome } from './export-behavior.js';
import type { HostAdapter, HostExportFormat } from './adapter.js';
import { CLI_LABELS, OBSIDIAN_LABELS, VSCODE_LABELS } from './labels.js';

const STATIC_NO_PACKS: ExportRenderInfo = {
  engine: 'static',
  reason: 'no-packs',
};
const REACT_RENDER: ExportRenderInfo = {
  engine: 'react',
  packCount: 2,
  stylesheetCount: 1,
};

function fakeAdapter(
  formats: readonly HostExportFormat[],
  overrides: Partial<HostAdapter> = {},
): HostAdapter {
  const written: { path: string; bytes: Uint8Array }[] = [];
  return {
    id: 'cli',
    labels: CLI_LABELS,
    readFile: async () => new Uint8Array(),
    exists: async () => false,
    writeFile: async (path, bytes) => {
      written.push({ path, bytes });
    },
    listFolder: async () => [],
    prompt: async () => false,
    memento: {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      update: () => Promise.resolve(),
    },
    diagnostics: () => {},
    now: () => 1_000,
    exports: {
      formats: new Set(formats),
      resolveTarget: async (name) => `/exports/${name}`,
    },
    ...overrides,
  };
}

describe('exportDefaultFileName', () => {
  it('names the export after the note, with the right extension per format', () => {
    expect(exportDefaultFileName('/a/b/note.mk.md', 'html')).toBe('note.html');
    expect(exportDefaultFileName('/a/b/note.mk.md', 'pdf')).toBe('note.pdf');
    expect(exportDefaultFileName('/a/b/note.mk.md', 'ansi')).toBe('note.txt');
    expect(exportDefaultFileName('/a/b/note.mk.md', 'md-plain')).toBe(
      'note.md',
    );
  });
});

describe('exportResultMessage', () => {
  it('names the written file, by name only', () => {
    const outcome: NoteFileExportOutcome = {
      kind: 'written',
      path: '/a/b/note.html',
      bytes: 100,
      valueCount: 3,
      render: STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    };
    expect(exportResultMessage(outcome, VSCODE_LABELS)).toBe(
      'Markii: exported note.html.',
    );
  });

  it('says so when nothing was baked in and the note has scripts', () => {
    const outcome: NoteFileExportOutcome = {
      kind: 'written',
      path: '/a/b/note.html',
      bytes: 100,
      valueCount: 0,
      hasScripts: true,
      render: STATIC_NO_PACKS,
      images: EMPTY_IMAGE_REPORT,
    };
    expect(exportResultMessage(outcome, VSCODE_LABELS)).toContain(
      'empty states',
    );
  });

  it("points a failure at this host's own diagnostics surface, never the reason", () => {
    const outcome: NoteFileExportOutcome = {
      kind: 'failed',
      reason: 'disk full',
    };
    expect(exportResultMessage(outcome, VSCODE_LABELS)).toBe(
      'Markii: could not export this note. Open the Markii output channel for details.',
    );
    expect(exportResultMessage(outcome, OBSIDIAN_LABELS)).toBe(
      'Markii: could not export this note. Open the Markii diagnostics for details.',
    );
    expect(exportResultMessage(outcome, VSCODE_LABELS)).not.toContain(
      'disk full',
    );
  });
});

describe('renderEngineDiagnosticLine', () => {
  it('describes a react render with pack and stylesheet counts', () => {
    expect(renderEngineDiagnosticLine(REACT_RENDER)).toContain('2 packs');
    expect(renderEngineDiagnosticLine(REACT_RENDER)).toContain('1 stylesheet');
  });

  it('describes the no-packs static fallback', () => {
    expect(renderEngineDiagnosticLine(STATIC_NO_PACKS)).toContain(
      'no pack components are loaded',
    );
  });
});

describe('imageEmbedDiagnosticLines', () => {
  it('is empty for a note with no images', () => {
    expect(imageEmbedDiagnosticLines(EMPTY_IMAGE_REPORT)).toEqual([]);
  });

  it('reports embedded and skipped images', () => {
    const report: EmbeddedImageReport = {
      embedded: ['a.png'],
      embeddedBytes: 2048,
      skipped: [
        { src: 'huge.png', reason: 'too-large', byteLength: 5_000_000 },
      ],
      remote: 1,
    };
    const lines = imageEmbedDiagnosticLines(report);
    expect(lines[0]).toContain('Embedded 1 image');
    expect(lines[1]).toContain('Skipped huge.png');
    expect(lines[2]).toContain('1 image source');
  });
});

describe('exportDiagnosticLines', () => {
  it('records a failure reason verbatim', () => {
    const lines = exportDiagnosticLines({ kind: 'failed', reason: 'boom' });
    expect(lines[0]).toContain('boom');
  });

  it('never leaks an em dash', () => {
    const outcomes: NoteFileExportOutcome[] = [
      {
        kind: 'written',
        path: '/x.html',
        bytes: 10,
        valueCount: 1,
        render: STATIC_NO_PACKS,
        images: EMPTY_IMAGE_REPORT,
      },
      { kind: 'failed', reason: 'x' },
    ];
    for (const outcome of outcomes) {
      for (const line of exportDiagnosticLines(outcome)) {
        expect(line).not.toContain('—');
      }
      expect(exportResultMessage(outcome, VSCODE_LABELS)).not.toContain('—');
    }
  });
});

describe('exportNoteFileViaAdapter', () => {
  const request = { notePath: '/vault/note.mk.md', text: '# Hello\n' };

  it('returns undefined (Unsupported territory) for a format the adapter has not declared', async () => {
    const adapter = fakeAdapter(['html']);
    const outcome = await exportNoteFileViaAdapter(adapter, 'pdf', request);
    expect(outcome).toBeUndefined();
  });

  it('writes an html export through resolveTarget and writeFile', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const adapter = fakeAdapter(['html'], {
      writeFile: async (path, bytes) => {
        written.push({ path, bytes });
      },
    });
    const outcome = await exportNoteFileViaAdapter(adapter, 'html', request);
    expect(outcome?.kind).toBe('written');
    if (outcome?.kind !== 'written') throw new Error('expected written');
    expect(outcome.path).toBe('/exports/note.html');
    expect(written).toHaveLength(1);
    expect(new TextDecoder().decode(written[0]!.bytes)).toContain('<html');
  });

  it('cancels (undefined) when resolveTarget declines', async () => {
    const adapter = fakeAdapter(['html'], {
      exports: {
        formats: new Set<HostExportFormat>(['html']),
        resolveTarget: async () => undefined,
      },
    });
    const outcome = await exportNoteFileViaAdapter(adapter, 'html', request);
    expect(outcome).toBeUndefined();
  });

  it('writes an md-plain export using mdPlainFromSource', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const adapter = fakeAdapter(['md-plain'], {
      writeFile: async (path, bytes) => {
        written.push({ path, bytes });
      },
    });
    const outcome = await exportNoteFileViaAdapter(adapter, 'md-plain', {
      notePath: '/vault/note.mk.md',
      text: 'Before.\n\n::divider\n\nAfter.\n',
    });
    expect(outcome?.kind).toBe('written');
    expect(new TextDecoder().decode(written[0]!.bytes)).toBe(
      'Before.\n\nAfter.\n',
    );
  });

  it('ansi format with no renderAnsi injected resolves undefined, never throws', async () => {
    const adapter = fakeAdapter(['ansi']);
    const outcome = await exportNoteFileViaAdapter(adapter, 'ansi', request);
    expect(outcome).toBeUndefined();
  });

  it('ansi format calls the injected renderer and writes its output', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const adapter = fakeAdapter(['ansi'], {
      writeFile: async (path, bytes) => {
        written.push({ path, bytes });
      },
    });
    const outcome = await exportNoteFileViaAdapter(
      adapter,
      'ansi',
      request,
      async (text) => `ANSI:${text}`,
    );
    expect(outcome?.kind).toBe('written');
    expect(new TextDecoder().decode(written[0]!.bytes)).toBe('ANSI:# Hello\n');
  });

  it('pdf format with no htmlToPdf seam resolves undefined', async () => {
    const adapter = fakeAdapter(['pdf']);
    const outcome = await exportNoteFileViaAdapter(adapter, 'pdf', request);
    expect(outcome).toBeUndefined();
  });

  it('pdf format calls adapter.exports.htmlToPdf and writes the bytes', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const adapter = fakeAdapter(['pdf'], {
      writeFile: async (path, bytes) => {
        written.push({ path, bytes });
      },
      exports: {
        formats: new Set<HostExportFormat>(['pdf']),
        resolveTarget: async (name) => `/exports/${name}`,
        htmlToPdf: async () => new Uint8Array([1, 2, 3]),
      },
    });
    const outcome = await exportNoteFileViaAdapter(adapter, 'pdf', request);
    expect(outcome?.kind).toBe('written');
    if (outcome?.kind !== 'written') throw new Error('expected written');
    expect(outcome.path).toBe('/exports/note.pdf');
    expect(written[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('a thrown error during html export becomes a failed outcome, never a rejection', async () => {
    const adapter = fakeAdapter(['html'], {
      writeFile: async () => {
        throw new Error('disk full');
      },
    });
    const outcome = await exportNoteFileViaAdapter(adapter, 'html', request);
    expect(outcome).toEqual({ kind: 'failed', reason: 'disk full' });
  });
});

describe('fileNameOf', () => {
  it('takes the last segment of either slash style', () => {
    expect(fileNameOf('/a/b/note.html')).toBe('note.html');
    expect(fileNameOf('C:\\a\\b\\note.html')).toBe('note.html');
    expect(fileNameOf('note.html')).toBe('note.html');
  });
});

describe('buildExportDocument', () => {
  // Regression: `hideScriptBlocks` was accepted on the request and then
  // silently dropped on the way to `buildNoteExport`, so a host whose
  // reader had asked to hide script markers still exported them. A
  // dropped option is worse than a rejected one: nothing reports it.
  it('forwards hideScriptBlocks so the exported document actually hides script markers', async () => {
    const text = '```lua {name=total}\nreturn 1\n```\n';

    const hidden = await buildExportDocument({
      notePath: 'note.mk.md',
      text,
      hideScriptBlocks: true,
    });
    const shown = await buildExportDocument({
      notePath: 'note.mk.md',
      text,
    });

    // The class NAME always appears, because the embedded stylesheet
    // defines a rule for it either way. What the option decides is
    // whether the document element actually carries the class.
    const docClass = `class="doc ${EXPORT_HIDE_SCRIPT_BLOCKS_CLASS}"`;
    expect(hidden.html).toContain(docClass);
    expect(shown.html).not.toContain(docClass);
    expect(shown.html).toContain('class="doc"');
  });
});
