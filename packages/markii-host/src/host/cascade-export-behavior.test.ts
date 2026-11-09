import { createHtmlExportEngine } from '../html-engine.js';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type {
  CascadeLinkResolver,
  CascadeNoteReader,
} from '../export/cascade.js';
import { EMPTY_IMAGE_REPORT } from '../export/image-embed.js';
import {
  buildCascadeArchive,
  cascadeDiagnosticLines,
  cascadeResultMessage,
  type CascadeArchiveRequest,
  type CascadeExportOutcome,
} from './cascade-export-behavior.js';
import { OBSIDIAN_LABELS, VSCODE_LABELS } from './labels.js';

/** A fake workspace: path to text, links resolved relative to the linking note's folder. */
function workspace(notes: Record<string, string>): {
  readNote: CascadeNoteReader;
  resolveLink: CascadeLinkResolver;
} {
  return {
    readNote: (path) => notes[path],
    resolveLink: (link, from) => {
      const folder = from.slice(0, from.lastIndexOf('/') + 1);
      const target = `${folder}${link.path}`;
      return target in notes ? target : undefined;
    },
  };
}

function request(
  notes: Record<string, string>,
  over: Partial<CascadeArchiveRequest> = {},
): CascadeArchiveRequest {
  const ws = workspace(notes);
  return {
    engine: createHtmlExportEngine(),
    rootPath: '/ws/index.mk.md',
    readNote: ws.readNote,
    resolveLink: ws.resolveLink,
    readValues: () => ({}),
    ...over,
  };
}

function entryNames(bytes: Uint8Array): string[] {
  return Object.keys(unzipSync(bytes)).sort();
}

const render = { engine: 'static', reason: 'no-packs', packCount: 0 } as const;

function written(
  over: Partial<Extract<CascadeExportOutcome, { kind: 'written' }>> = {},
): CascadeExportOutcome {
  return {
    kind: 'written',
    path: '/out/index.zip',
    bytes: 10,
    notes: [
      {
        path: '/ws/index.mk.md',
        entryName: 'index.html',
        valueCount: 1,
        render,
        images: EMPTY_IMAGE_REPORT,
      },
    ],
    unreadable: [],
    ...over,
  };
}

describe('buildCascadeArchive', () => {
  it('walks a chain of links and exports every note, rewriting links between them', async () => {
    const result = await buildCascadeArchive(
      request({
        '/ws/index.mk.md': '# Index\n\nSee [B](b.mk.md).\n',
        '/ws/b.mk.md': '# B\n\nBack to [index](index.mk.md).\n',
      }),
    );
    if (result.kind !== 'archive') throw new Error('expected an archive');
    expect(result.notes.map((n) => n.path)).toEqual([
      '/ws/index.mk.md',
      '/ws/b.mk.md',
    ]);
    const names = entryNames(result.bytes);
    expect(names).toHaveLength(3);
    const html = strFromU8(
      unzipSync(result.bytes)[result.notes[0]!.entryName]!,
    );
    expect(html).toContain(`href="${result.notes[1]!.entryName}"`);
  });

  it('always adds an index page, and keeps a note named index clear of it', async () => {
    const notes = { '/ws/index.mk.md': '# Index\n' };
    const result = await buildCascadeArchive(request(notes));
    if (result.kind !== 'archive') throw new Error('expected an archive');
    expect(entryNames(result.bytes)).toHaveLength(2);
    expect(entryNames(result.bytes)).toContain('index.html');
    expect(result.notes[0]?.entryName).not.toBe('index.html');
  });

  it('records an unreadable linked note without failing the export', async () => {
    const result = await buildCascadeArchive(
      request(
        { '/ws/index.mk.md': '[gone](gone.mk.md)\n' },
        {
          resolveLink: () => '/ws/gone.mk.md',
        },
      ),
    );
    if (result.kind !== 'archive') throw new Error('expected an archive');
    expect(result.unreadable).toEqual([
      { path: '/ws/gone.mk.md', from: '/ws/index.mk.md' },
    ]);
  });

  it('fails rather than throwing when the root cannot be read, or the reader throws', async () => {
    const missing = await buildCascadeArchive(request({}));
    expect(missing).toEqual({
      kind: 'failed',
      reason: 'could not read the root note /ws/index.mk.md',
    });
    const thrown = await buildCascadeArchive(
      request(
        {},
        {
          readValues: () => {
            throw new Error('boom');
          },
          readNote: () => '# x\n',
        },
      ),
    );
    expect(thrown).toEqual({ kind: 'failed', reason: 'boom' });
  });
});

describe('cascadeResultMessage', () => {
  it('names the archive and its note count, with an optional host sentence', () => {
    expect(cascadeResultMessage(written(), VSCODE_LABELS)).toBe(
      'Markii: exported index.zip with 1 note.',
    );
    expect(
      cascadeResultMessage(written(), OBSIDIAN_LABELS, 'It sits beside.'),
    ).toBe('Markii: exported index.zip with 1 note. It sits beside.');
  });

  it('points a partial export at the host diagnostics surface', () => {
    const message = cascadeResultMessage(
      written({ truncated: 'depth' }),
      OBSIDIAN_LABELS,
      'ignored when partial',
    );
    expect(message).toContain('left out');
    expect(message).toContain(OBSIDIAN_LABELS.diagnosticsSurface);
    expect(message).not.toContain('ignored');
  });

  it('points a failure at the surface without the reason', () => {
    const message = cascadeResultMessage(
      { kind: 'failed', reason: 'secret detail' },
      VSCODE_LABELS,
    );
    expect(message).toContain(VSCODE_LABELS.diagnosticsSurface);
    expect(message).not.toContain('secret detail');
    expect(message).not.toMatch(/—|\(/);
  });
});

describe('cascadeDiagnosticLines', () => {
  it('names the archive, every note, the bound, and every unreadable note', () => {
    const lines = cascadeDiagnosticLines(
      written({
        truncated: 'count',
        unreadable: [{ path: '/ws/x.mk.md', from: '/ws/index.mk.md' }],
      }),
    );
    expect(lines[0]).toContain('/out/index.zip');
    expect(lines.join('\n')).toContain(
      'Exported /ws/index.mk.md as index.html',
    );
    expect(lines.join('\n')).toContain('maximum of 100 notes');
    expect(lines.join('\n')).toContain(
      'Could not read /ws/x.mk.md, linked from /ws/index.mk.md.',
    );
    for (const line of lines) expect(line).not.toMatch(/—/);
  });

  it('reports a failure with the verbatim reason and the path when known', () => {
    expect(
      cascadeDiagnosticLines({
        kind: 'failed',
        path: '/o.zip',
        reason: 'nope',
      }),
    ).toEqual(['Cascade export failed to /o.zip: nope']);
    expect(cascadeDiagnosticLines({ kind: 'failed', reason: 'nope' })).toEqual([
      'Cascade export failed: nope',
    ]);
  });
});
