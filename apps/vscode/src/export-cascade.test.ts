import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import type { CascadeLinkResolver, CascadeNoteReader } from '@markii/host';
import { resolveNoteRelativeLink } from './cascade-links.js';
import {
  EXPORT_CASCADE_FILTERS,
  EXPORT_CASCADE_NO_DOCUMENT_MESSAGE,
  EXPORT_CASCADE_SAVE_DIALOG_TITLE,
  EXPORT_CASCADE_SAVE_LABEL,
  buildNoteCascadeArchive,
  exportCascadeDefaultFileName,
  exportCascadeDiagnosticLines,
  exportCascadeResultMessage,
} from './export-cascade.js';
import type {
  CascadeArchiveRequest,
  CascadeExportOutcome,
  CascadeExportedNote,
} from './export-cascade.js';

/**
 * A fake workspace: note paths (in `vscode.Uri.path` form) to note text.
 * `resolveLink` is exactly the composition `preview-panel.ts` wires, the
 * pure `resolveNoteRelativeLink` followed by a root check, with the root
 * here being one folder so a `..` climb out of it is refused the way a
 * link outside the workspace is refused in the real command.
 */
function createWorkspace(
  notes: Record<string, string>,
  root = '/ws',
): { readNote: CascadeNoteReader; resolveLink: CascadeLinkResolver } {
  return {
    readNote: (path) => notes[path],
    resolveLink: (link, fromNotePath) => {
      const resolved = resolveNoteRelativeLink(fromNotePath, link.path);
      if (resolved === undefined) return undefined;
      return resolved === root || resolved.startsWith(`${root}/`)
        ? resolved
        : undefined;
    },
  };
}

function baseRequest(
  workspace: ReturnType<typeof createWorkspace>,
  rootPath: string,
): CascadeArchiveRequest {
  return {
    rootPath,
    readNote: workspace.readNote,
    resolveLink: workspace.resolveLink,
    readValues: () => ({}),
  };
}

/**
 * A dependency-free zip reader for tests. `fflate` is scoped to
 * `@markii/bundle` and `@markii/host` under this repo's Stack section, so
 * this walks the central directory by hand with `node:buffer` and
 * `node:zlib`, both Node builtins, exactly as the Obsidian plugin's
 * cascade test does.
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const signature = 0x06054b50;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error('not a zip file: no end of central directory record');
}

interface ZipEntry {
  readonly name: string;
  readonly compression: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(bytes);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, compression, compressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function archiveEntryNames(bytes: Uint8Array): string[] {
  return readZipEntries(bytes)
    .map((entry) => entry.name)
    .sort();
}

function readZipEntryText(bytes: Uint8Array, entryName: string): string {
  const buffer = Buffer.from(bytes);
  const entry = readZipEntries(bytes).find(
    (candidate) => candidate.name === entryName,
  );
  if (!entry) throw new Error(`entry not found: ${entryName}`);
  const localNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart =
    entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressed = buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  const raw = entry.compression === 0 ? compressed : inflateRawSync(compressed);
  return raw.toString('utf8');
}

describe('exportCascadeDefaultFileName', () => {
  it('names the archive after the root note', () => {
    expect(exportCascadeDefaultFileName('/ws/notes/index.mk.md')).toBe(
      'index.zip',
    );
    expect(exportCascadeDefaultFileName('/ws/plain.md')).toBe('plain.zip');
  });
});

describe('buildNoteCascadeArchive', () => {
  it('walks a chain of note-relative markdown links and exports every note', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\nSee [B](sub/b.mk.md).\n',
      '/ws/sub/b.mk.md': '# B\n\nSee [C](../c.md).\n',
      '/ws/c.md': '# C\n\nEnd.\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/index.mk.md'),
    );

    expect(result.kind).toBe('archive');
    if (result.kind !== 'archive') throw new Error('unreachable');
    expect(result.notes.map((note) => note.path)).toEqual([
      '/ws/index.mk.md',
      '/ws/sub/b.mk.md',
      '/ws/c.md',
    ]);
    expect(archiveEntryNames(result.bytes)).toEqual([
      'b.html',
      'c.html',
      'index.html',
    ]);
    expect(result.truncated).toBeUndefined();
    expect(result.unreadable).toEqual([]);
  });

  it('rewrites a link between two exported notes to the exported file name', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\nSee [B](sub/b.mk.md).\n',
      '/ws/sub/b.mk.md': '# B\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/index.mk.md'),
    );
    if (result.kind !== 'archive') throw new Error('unreachable');

    const html = readZipEntryText(result.bytes, 'index.html');
    expect(html).toContain('href="b.html"');
    expect(html).not.toContain('sub/b.mk.md');
  });

  it('never follows a link that leaves the workspace, and leaves it as written', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\nSee [Outside](../secrets/other.md).\n',
      '/secrets/other.md': '# Secret\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/index.mk.md'),
    );
    if (result.kind !== 'archive') throw new Error('unreachable');

    expect(result.notes.map((note) => note.path)).toEqual(['/ws/index.mk.md']);
    expect(result.unreadable).toEqual([]);
    expect(readZipEntryText(result.bytes, 'index.html')).toContain(
      '../secrets/other.md',
    );
  });

  it('exports each note once when notes link to each other in a cycle', async () => {
    const workspace = createWorkspace({
      '/ws/a.mk.md': '# A\n\n[B](b.mk.md)\n',
      '/ws/b.mk.md': '# B\n\n[A](a.mk.md)\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/a.mk.md'),
    );
    if (result.kind !== 'archive') throw new Error('unreachable');

    expect(result.notes).toHaveLength(2);
    expect(archiveEntryNames(result.bytes)).toEqual(['a.html', 'b.html']);
  });

  it('gives two notes with the same base name distinct archive names', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\n[One](one/notes.md) [Two](two/notes.md)\n',
      '/ws/one/notes.md': '# One\n',
      '/ws/two/notes.md': '# Two\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/index.mk.md'),
    );
    if (result.kind !== 'archive') throw new Error('unreachable');

    expect(archiveEntryNames(result.bytes)).toEqual([
      'index.html',
      'notes-2.html',
      'notes.html',
    ]);
  });

  it('records a linked note it could not read without failing the export', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\n[Gone](gone.mk.md)\n',
    });
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/index.mk.md'),
    );
    if (result.kind !== 'archive') throw new Error('unreachable');

    expect(result.notes).toHaveLength(1);
    expect(result.unreadable).toEqual([
      { path: '/ws/gone.mk.md', from: '/ws/index.mk.md' },
    ]);
  });

  it('bakes each note own stored values into that note file', async () => {
    const workspace = createWorkspace({
      '/ws/index.mk.md': '# Index\n\n:value[total]\n\n[B](b.mk.md)\n',
      '/ws/b.mk.md': '# B\n\n:value[total]\n',
    });
    const result = await buildNoteCascadeArchive({
      ...baseRequest(workspace, '/ws/index.mk.md'),
      readValues: (path) =>
        path === '/ws/index.mk.md'
          ? { total: { value: 41, status: 'fresh' as const } }
          : { total: { value: 7, status: 'fresh' as const } },
    });
    if (result.kind !== 'archive') throw new Error('unreachable');

    expect(readZipEntryText(result.bytes, 'index.html')).toContain('41');
    expect(readZipEntryText(result.bytes, 'b.html')).toContain('7');
    expect(result.notes.map((note) => note.valueCount)).toEqual([1, 1]);
  });

  it('fails, rather than throwing, when the root note cannot be read', async () => {
    const workspace = createWorkspace({});
    const result = await buildNoteCascadeArchive(
      baseRequest(workspace, '/ws/missing.mk.md'),
    );

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('/ws/missing.mk.md');
  });

  it('fails, rather than throwing, when a note reader throws outright', async () => {
    const result = await buildNoteCascadeArchive({
      rootPath: '/ws/index.mk.md',
      readNote: () => '# Index\n',
      resolveLink: () => undefined,
      readValues: () => {
        throw new Error('workspace state exploded');
      },
    });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('unreachable');
    expect(result.reason).toBe('workspace state exploded');
  });
});

const EXPORTED_NOTE: CascadeExportedNote = {
  path: '/ws/index.mk.md',
  entryName: 'index.html',
  valueCount: 2,
  render: { engine: 'static', reason: 'no-packs' },
  images: { embedded: [], embeddedBytes: 0, skipped: [], remote: 0 },
};

const WRITTEN: CascadeExportOutcome = {
  kind: 'written',
  path: '/ws/index.zip',
  bytes: 4096,
  notes: [
    EXPORTED_NOTE,
    { ...EXPORTED_NOTE, path: '/ws/b.mk.md', entryName: 'b.html' },
  ],
  unreadable: [],
};

describe('exportCascadeResultMessage', () => {
  it('names the archive and how many notes it holds', () => {
    expect(exportCascadeResultMessage(WRITTEN)).toBe(
      'Markii: exported index.zip with 2 notes.',
    );
  });

  it('says one note in the singular', () => {
    expect(
      exportCascadeResultMessage({ ...WRITTEN, notes: [EXPORTED_NOTE] }),
    ).toBe('Markii: exported index.zip with 1 note.');
  });

  it('points a partial export at the diagnostics surface', () => {
    expect(
      exportCascadeResultMessage({ ...WRITTEN, truncated: 'depth' }),
    ).toContain('open the Markii output');
    expect(
      exportCascadeResultMessage({
        ...WRITTEN,
        unreadable: [{ path: '/ws/gone.md', from: '/ws/index.mk.md' }],
      }),
    ).toContain('open the Markii output');
  });

  it('points a failure at the diagnostics surface without the reason', () => {
    const message = exportCascadeResultMessage({
      kind: 'failed',
      reason: 'EACCES: permission denied',
    });
    expect(message).toBe(
      'Markii: could not export this cascade. Open the Markii output for details.',
    );
    expect(message).not.toContain('EACCES');
  });

  it('has no em dash and no parentheses, and at most two sentences', () => {
    const messages = [
      exportCascadeResultMessage(WRITTEN),
      exportCascadeResultMessage({ ...WRITTEN, truncated: 'count' }),
      exportCascadeResultMessage({ kind: 'failed', reason: 'nope' }),
      EXPORT_CASCADE_NO_DOCUMENT_MESSAGE,
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/[—(]/);
      const sentences = message.split('. ').filter((part) => part.length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('exportCascadeDiagnosticLines', () => {
  it('names every exported note and the archive it wrote', () => {
    const lines = exportCascadeDiagnosticLines(WRITTEN);
    expect(lines[0]).toBe(
      'Cascade export wrote /ws/index.zip: 4096 bytes, 2 notes.',
    );
    expect(lines).toContain(
      'Exported /ws/index.mk.md as index.html with 2 stored values baked in.',
    );
    expect(lines).toContain(
      'Exported /ws/b.mk.md as b.html with 2 stored values baked in.',
    );
  });

  it('names the bound that stopped the walk', () => {
    expect(
      exportCascadeDiagnosticLines({ ...WRITTEN, truncated: 'depth' }).join(
        '\n',
      ),
    ).toContain('maximum depth');
    expect(
      exportCascadeDiagnosticLines({ ...WRITTEN, truncated: 'count' }).join(
        '\n',
      ),
    ).toContain('maximum of 100 notes');
  });

  it('names every note it could not read and what linked to it', () => {
    const lines = exportCascadeDiagnosticLines({
      ...WRITTEN,
      unreadable: [{ path: '/ws/gone.md', from: '/ws/index.mk.md' }],
    });
    expect(lines).toContain(
      'Could not read /ws/gone.md, linked from /ws/index.mk.md.',
    );
  });

  it('reports a failure with the verbatim reason', () => {
    expect(
      exportCascadeDiagnosticLines({
        kind: 'failed',
        path: '/ws/index.zip',
        reason: 'EACCES: permission denied',
      }),
    ).toEqual([
      'Cascade export failed to /ws/index.zip: EACCES: permission denied',
    ]);
  });

  it('reports each note render engine and its skipped images', () => {
    const lines = exportCascadeDiagnosticLines({
      ...WRITTEN,
      notes: [
        {
          ...EXPORTED_NOTE,
          render: { engine: 'react', packCount: 1, stylesheetCount: 1 },
          images: {
            embedded: ['nice.png'],
            embeddedBytes: 1024,
            skipped: [{ src: 'huge.png', reason: 'too-large', byteLength: 1 }],
            remote: 0,
          },
        },
      ],
    }).join('\n');
    expect(lines).toContain("Rendered through the preview's React engine");
    expect(lines).toContain('Skipped huge.png');
  });
});

describe('the save dialog wording', () => {
  it('offers zip archives and names the command', () => {
    expect(EXPORT_CASCADE_SAVE_DIALOG_TITLE).toBe(
      'Markii: Export as HTML cascade',
    );
    expect(EXPORT_CASCADE_SAVE_LABEL).toBe('Export');
    expect(EXPORT_CASCADE_FILTERS['Zip archive']).toEqual(['zip']);
  });
});
