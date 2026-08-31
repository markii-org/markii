import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import type { CascadeLinkResolver, CascadeNoteReader } from '@markii/host';
import {
  exportCascadeDiagnosticLines,
  exportCascadeNoticeText,
  exportNoteCascade,
} from './cascade-export.js';
import type {
  CascadeExportOutcome,
  CascadeExportRequest,
} from './cascade-export.js';
import type { NoteExportFs } from '../export-note.js';

/** An in-memory `NoteExportFs` that records every binary write. */
function createFs(): { fs: NoteExportFs; binary: Map<string, Uint8Array> } {
  const binary = new Map<string, Uint8Array>();
  const fs: NoteExportFs = {
    writeText: () =>
      Promise.reject(new Error('cascade export never writes text')),
    writeBinary(path, data) {
      binary.set(path, data);
      return Promise.resolve();
    },
  };
  return { fs, binary };
}

/**
 * A tiny fake vault: a plain map of path to note text. `resolveLink`
 * accepts a link whose target is exactly a key in the map, mirroring how
 * a real host resolver only accepts a note it can actually export; every
 * other target is left as written, exactly like a link to something
 * outside the vault.
 */
function createFakeVault(notes: Record<string, string>): {
  readNote: CascadeNoteReader;
  resolveLink: CascadeLinkResolver;
} {
  return {
    readNote: (path) => notes[path],
    resolveLink: (link) =>
      Object.prototype.hasOwnProperty.call(notes, link.path)
        ? link.path
        : undefined,
  };
}

/** A `CascadeExportRequest` with the static engine and no images, minus the vault seams a test supplies. */
function baseRequest(
  vault: { readNote: CascadeNoteReader; resolveLink: CascadeLinkResolver },
  fs: NoteExportFs,
  rootPath: string,
): CascadeExportRequest {
  return {
    rootPath,
    readNote: vault.readNote,
    resolveLink: vault.resolveLink,
    readValues: () => ({}),
    fs,
  };
}

/**
 * A minimal, dependency-free zip reader for tests: no library is
 * approved for `apps/obsidian` to read a zip (`fflate` is scoped to
 * `@markii/bundle` and `@markii/host` under this repo's Stack section), so
 * this walks the central directory by hand with `node:buffer` and
 * `node:zlib`, both Node builtins. It reads only what `zipExportArchive`
 * produces: one End of Central Directory record and a flat list of
 * central directory entries, each optionally deflate-compressed.
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
  const compressedData = buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  const raw =
    entry.compression === 0 ? compressedData : inflateRawSync(compressedData);
  return raw.toString('utf8');
}

describe('exportNoteCascade', () => {
  it('walks a linear chain and exports every note reached', async () => {
    const vault = createFakeVault({
      'root.mk.md': '# Root\n\nSee [[b.mk.md]].\n',
      'b.mk.md': '# B\n\nSee [[c.mk.md]].\n',
      'c.mk.md': '# C\n\nEnd.\n',
    });
    const { fs, binary } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    expect(outcome.notes.map((note) => note.path)).toEqual([
      'root.mk.md',
      'b.mk.md',
      'c.mk.md',
    ]);
    expect(outcome.archivePath).toBe('root.zip');
    expect(outcome.truncated).toBeUndefined();
    expect(outcome.unreadable).toEqual([]);

    const bytes = binary.get('root.zip');
    expect(bytes).toBeDefined();
    expect(archiveEntryNames(bytes!)).toEqual([
      'b.html',
      'c.html',
      'root.html',
    ]);
  });

  it('does not loop forever on a cycle and exports each note once', async () => {
    const vault = createFakeVault({
      'a.mk.md': '# A\n\nSee [[b.mk.md]].\n',
      'b.mk.md': '# B\n\nBack to [[a.mk.md]].\n',
    });
    const { fs } = createFs();
    const outcome = await exportNoteCascade(baseRequest(vault, fs, 'a.mk.md'));

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    expect(outcome.notes.map((note) => note.path)).toEqual([
      'a.mk.md',
      'b.mk.md',
    ]);
  });

  it('truncates a walk deeper than the default max depth and says so', async () => {
    const notes: Record<string, string> = {
      'root.mk.md': '[[n1.mk.md]]',
      'n1.mk.md': '[[n2.mk.md]]',
      'n2.mk.md': '[[n3.mk.md]]',
      'n3.mk.md': '[[n4.mk.md]]',
      'n4.mk.md': '[[n5.mk.md]]',
      'n5.mk.md': 'leaf',
    };
    const vault = createFakeVault(notes);
    const { fs } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    // root through n4 is depth 0..4, five notes; n5 is one hop past the
    // default max depth of 4 and is never reached.
    expect(outcome.notes.map((note) => note.path)).toEqual([
      'root.mk.md',
      'n1.mk.md',
      'n2.mk.md',
      'n3.mk.md',
      'n4.mk.md',
    ]);
    expect(outcome.truncated).toBe('depth');
  });

  it('leaves a link to a note outside the exported set exactly as written', async () => {
    const vault = createFakeVault({
      'root.mk.md': '# Root\n\nSee [[b.mk.md]] and [[outside.mk.md]].\n',
      'b.mk.md': '# B\n\nEnd.\n',
    });
    const { fs, binary } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    expect(outcome.notes.map((note) => note.path)).toEqual([
      'root.mk.md',
      'b.mk.md',
    ]);

    const bytes = binary.get('root.zip')!;
    const rootHtml = readZipEntryText(bytes, 'root.html');
    // Rewritten because it's in the export set.
    expect(rootHtml).toContain('b.html');
    // Left as written because it's outside the export set: the raw
    // wikilink survives, which Markii renders as literal text.
    expect(rootHtml).toContain('[[outside.mk.md]]');
  });

  it('assigns distinct archive names to two notes that share a base name', async () => {
    const vault = createFakeVault({
      'root.mk.md':
        '# Root\n\nSee [[folder-a/dup.mk.md]] and [[folder-b/dup.mk.md]].\n',
      'folder-a/dup.mk.md': '# A dup\n',
      'folder-b/dup.mk.md': '# B dup\n',
    });
    const { fs, binary } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    const entryNames = outcome.notes.map((note) => note.entryName);
    expect(new Set(entryNames).size).toBe(entryNames.length);
    expect(entryNames).toContain('dup.html');
    expect(entryNames).toContain('dup-2.html');

    const bytes = binary.get('root.zip')!;
    expect(archiveEntryNames(bytes)).toEqual([...entryNames].sort());
  });

  it('records a linked note that could not be read, without failing the export', async () => {
    const vault: {
      readNote: CascadeNoteReader;
      resolveLink: CascadeLinkResolver;
    } = {
      readNote: (path) =>
        path === 'root.mk.md'
          ? '# Root\n\nSee [[missing.mk.md]].\n'
          : undefined,
      resolveLink: (link) =>
        link.path === 'missing.mk.md' ? 'missing.mk.md' : undefined,
    };
    const { fs, binary } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );

    expect(outcome.kind).toBe('cascade');
    if (outcome.kind !== 'cascade') throw new Error('unreachable');
    expect(outcome.notes.map((note) => note.path)).toEqual(['root.mk.md']);
    expect(outcome.unreadable).toEqual([
      { path: 'missing.mk.md', from: 'root.mk.md' },
    ]);
    expect(binary.has('root.zip')).toBe(true);
  });

  it('one archive entry per exported note', async () => {
    const vault = createFakeVault({
      'root.mk.md': '[[b.mk.md]]\n[[c.mk.md]]',
      'b.mk.md': 'leaf',
      'c.mk.md': 'leaf',
    });
    const { fs, binary } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );
    if (outcome.kind !== 'cascade') throw new Error('unreachable');

    const entries = archiveEntryNames(binary.get('root.zip')!);
    expect(entries.length).toBe(outcome.notes.length);
  });

  it('reports a failed outcome, rather than throwing, when the root note cannot be read', async () => {
    const vault: {
      readNote: CascadeNoteReader;
      resolveLink: CascadeLinkResolver;
    } = {
      readNote: () => undefined,
      resolveLink: () => undefined,
    };
    const { fs } = createFs();
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );
    expect(outcome.kind).toBe('failed');
  });

  it('reports a failed outcome when writing the archive fails', async () => {
    const vault = createFakeVault({ 'root.mk.md': 'leaf' });
    const fs: NoteExportFs = {
      writeText: () => Promise.reject(new Error('unused')),
      writeBinary: () => Promise.reject(new Error('disk is full')),
    };
    const outcome = await exportNoteCascade(
      baseRequest(vault, fs, 'root.mk.md'),
    );
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');
    expect(outcome.reason).toContain('disk is full');
  });
});

const NOTICE_OUTCOMES: CascadeExportOutcome[] = [
  {
    kind: 'cascade',
    archivePath: 'reports/week.zip',
    notes: [
      {
        path: 'reports/week.mk.md',
        entryName: 'week.html',
        valueCount: 0,
        render: { engine: 'static', reason: 'no-packs' },
        images: { embedded: [], embeddedBytes: 0, skipped: [], remote: 0 },
      },
    ],
    unreadable: [],
  },
  { kind: 'failed', reason: 'disk is full' },
];

describe('exportCascadeNoticeText', () => {
  it('names the archive and how many notes it holds', () => {
    const text = exportCascadeNoticeText(NOTICE_OUTCOMES[0]!);
    expect(text).toContain('week.zip');
    expect(text).toContain('1 note');
  });

  it('points a failure at the diagnostics surface without the reason', () => {
    const text = exportCascadeNoticeText({
      kind: 'failed',
      reason: 'disk is full',
    });
    expect(text).toContain('Markii diagnostics');
    expect(text).not.toContain('disk is full');
  });

  it('contains no em dash, no parentheses, and at most two short sentences', () => {
    for (const outcome of NOTICE_OUTCOMES) {
      const text = exportCascadeNoticeText(outcome);
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/[()]/);
      const sentences = text.split('. ').filter((part) => part.length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
      expect(text.startsWith('Markii: ')).toBe(true);
    }
  });
});

describe('exportCascadeDiagnosticLines', () => {
  it('lists one line per exported note and the archive summary last', () => {
    const outcome: CascadeExportOutcome = {
      kind: 'cascade',
      archivePath: 'reports/week.zip',
      notes: [
        {
          path: 'reports/week.mk.md',
          entryName: 'week.html',
          valueCount: 2,
          render: { engine: 'static', reason: 'no-packs' },
          images: { embedded: [], embeddedBytes: 0, skipped: [], remote: 0 },
        },
        {
          path: 'reports/detail.mk.md',
          entryName: 'detail.html',
          valueCount: 0,
          render: { engine: 'static', reason: 'no-packs' },
          images: { embedded: [], embeddedBytes: 0, skipped: [], remote: 0 },
        },
      ],
      unreadable: [{ path: 'reports/gone.mk.md', from: 'reports/week.mk.md' }],
    };
    const lines = exportCascadeDiagnosticLines(outcome);
    expect(lines[0]).toContain('reports/week.mk.md');
    expect(lines[0]).toContain('week.html');
    expect(lines.join('\n')).toContain('reports/detail.mk.md');
    expect(lines.join('\n')).toContain('Could not read reports/gone.mk.md');
    expect(lines.join('\n')).toContain('linked from reports/week.mk.md');
    expect(lines[lines.length - 1]).toContain('reports/week.zip');
    expect(lines[lines.length - 1]).toContain('2 notes');
  });

  it('names the bound that stopped the walk', () => {
    const depthOutcome: CascadeExportOutcome = {
      kind: 'cascade',
      archivePath: 'reports/week.zip',
      notes: [],
      unreadable: [],
      truncated: 'depth',
    };
    expect(exportCascadeDiagnosticLines(depthOutcome).join('\n')).toContain(
      'maximum depth',
    );

    const countOutcome: CascadeExportOutcome = {
      kind: 'cascade',
      archivePath: 'reports/week.zip',
      notes: [],
      unreadable: [],
      truncated: 'count',
    };
    expect(exportCascadeDiagnosticLines(countOutcome).join('\n')).toContain(
      'maximum note count',
    );
  });

  it('reports a failure with the verbatim reason', () => {
    const lines = exportCascadeDiagnosticLines({
      kind: 'failed',
      reason: 'disk is full',
    });
    expect(lines.join('\n')).toContain('disk is full');
  });

  it('every diagnostics line contains no em dash and no parentheses', () => {
    const outcome: CascadeExportOutcome = {
      kind: 'cascade',
      archivePath: 'reports/week.zip',
      notes: [
        {
          path: 'reports/week.mk.md',
          entryName: 'week.html',
          valueCount: 1,
          render: { engine: 'static', reason: 'no-packs' },
          images: { embedded: [], embeddedBytes: 0, skipped: [], remote: 0 },
        },
      ],
      unreadable: [{ path: 'reports/gone.mk.md', from: 'reports/week.mk.md' }],
      truncated: 'count',
    };
    for (const line of exportCascadeDiagnosticLines(outcome)) {
      expect(line).not.toContain('—');
      expect(line).not.toMatch(/[()]/);
    }
  });
});
