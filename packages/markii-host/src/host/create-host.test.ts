import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import type { RunResult } from '../run/run-host.js';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import type { HostAdapter, HostEditor } from './adapter.js';
import { CLI_LABELS } from './labels.js';
import { createMarkiiHost } from './create-host.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-host-create-host-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makePackFolder(
  name: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `markii-host-pack-${name}-`));
  await writeFile(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return dir;
}

function validArchiveBytes(name = 'ana'): Uint8Array {
  const encoder = new TextEncoder();
  return zipSync({
    'pack.json': encoder.encode(
      JSON.stringify({ name, engine: 'react', components: {} }),
    ),
    'webview.js': encoder.encode('window.__markiiRegisterPack(() => ({}));'),
  });
}

function fakeEditor(text: string, line: number, column: number): HostEditor {
  return {
    documentText: () => text,
    documentPath: () => '/note.mk.md',
    cursor: () => ({ line, column }),
    applyEdits: async () => true,
  };
}

function createMemoryMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return store.has(key) ? (store.get(key) as T) : (defaultValue as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function fakeAdapter(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    id: 'cli',
    labels: CLI_LABELS,
    readFile: async () => new Uint8Array(),
    exists: async () => false,
    writeFile: async () => {},
    listFolder: async () => [],
    prompt: async () => false,
    memento: createMemoryMemento(),
    diagnostics: () => {},
    now: () => 0,
    ...overrides,
  };
}

describe('createMarkiiHost.open', () => {
  it('decodes the bytes readFile returns', async () => {
    const adapter = fakeAdapter({
      readFile: async () => new TextEncoder().encode('# hello'),
    });
    const host = createMarkiiHost(adapter);
    const outcome = await host.open({ path: 'note.mk.md' });
    expect(outcome).toEqual({ kind: 'opened', text: '# hello' });
  });

  it('reports a failed outcome and writes one diagnostics line, never throwing', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      readFile: async () => {
        throw new Error('ENOENT');
      },
      diagnostics: (line) => lines.push(line),
    });
    const host = createMarkiiHost(adapter);
    const outcome = await host.open({ path: 'missing.mk.md' });
    expect(outcome).toEqual({ kind: 'failed', reason: 'ENOENT' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('missing.mk.md');
  });
});

describe('createMarkiiHost.run', () => {
  it('declines with an unsupported outcome and one diagnostics line when the adapter has no isolate', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({ diagnostics: (line) => lines.push(line) });
    const host = createMarkiiHost(adapter);
    const outcome = await host.run({
      documentKey: 'doc',
      text: 'text',
      trigger: 'manual',
    });
    expect(outcome).toEqual({
      kind: 'unsupported',
      capability: 'isolate',
      detail: 'no isolate is configured, so scripts cannot run.',
    });
    expect(lines).toHaveLength(1);
  });

  it('runs through the injected spawnRun and returns a "ran" outcome when an isolate is configured', async () => {
    const fakeResult: RunResult = {
      values: {},
      failures: [],
      cacheSnapshot: {},
    };
    const adapter = fakeAdapter({
      isolate: { kind: 'node', workerPath: () => '/worker.js' },
    });
    const host = createMarkiiHost(adapter, {
      spawnRun: async () => fakeResult,
    });
    const outcome = await host.run({
      documentKey: 'doc',
      text: 'text',
      trigger: 'manual',
    });
    expect(outcome.kind).toBe('ran');
    if (outcome.kind === 'ran') {
      expect(outcome.values).toEqual({});
      expect(outcome.failures).toEqual([]);
    }
  });
});

describe('createMarkiiHost Phase 1b placeholders never throw and always write a diagnostics line', () => {
  it.each([
    [
      'exportNote',
      () =>
        createMarkiiHost(fakeAdapter()).exportNote({
          format: 'html',
          notePath: '/note.mk.md',
          text: '# hello',
        }),
    ],
    [
      'installPack',
      () =>
        createMarkiiHost(fakeAdapter()).installPack({
          archiveBytes: new Uint8Array(),
        }),
    ],
    ['loadPacks', () => createMarkiiHost(fakeAdapter()).loadPacks()],
    [
      'completeAt',
      () => createMarkiiHost(fakeAdapter()).completeAt({ line: 0, column: 0 }),
    ],
    [
      'hoverAt',
      () => createMarkiiHost(fakeAdapter()).hoverAt({ line: 0, column: 0 }),
    ],
    [
      'insertComponent',
      () =>
        createMarkiiHost(fakeAdapter()).insertComponent({ name: 'callout' }),
    ],
  ] as const)('%s returns unsupported', async (_name, call) => {
    const outcome = await call();
    expect(outcome.kind).toBe('unsupported');
  });

  it('writes a diagnostics line for a declined behavior', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({ diagnostics: (line) => lines.push(line) });
    const host = createMarkiiHost(adapter);
    await host.loadPacks();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('packs unsupported');
  });
});

describe('createMarkiiHost.diagnostics', () => {
  it('writes straight through to the adapter', () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({ diagnostics: (line) => lines.push(line) });
    const host = createMarkiiHost(adapter);
    host.diagnostics('hello');
    expect(lines).toEqual(['hello']);
  });
});

describe('createMarkiiHost.exportNote', () => {
  it('exports html when the adapter declares it, and writes a diagnostics line', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      writeFile: async (p, bytes) => {
        written.push({ path: p, bytes });
      },
      exports: {
        formats: new Set(['html']),
        resolveTarget: async (name) => `/exports/${name}`,
      },
    });
    const outcome = await createMarkiiHost(adapter).exportNote({
      format: 'html',
      notePath: '/note.mk.md',
      text: '# hello',
    });
    expect(outcome.kind).toBe('exported');
    if (outcome.kind !== 'exported') throw new Error('expected exported');
    expect(outcome.path).toBe('/exports/note.html');
    expect(written).toHaveLength(1);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('is cancelled, not thrown, when the picker declines', async () => {
    const adapter = fakeAdapter({
      exports: {
        formats: new Set(['html']),
        resolveTarget: async () => undefined,
      },
    });
    const outcome = await createMarkiiHost(adapter).exportNote({
      format: 'html',
      notePath: '/note.mk.md',
      text: '# hello',
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});

describe('createMarkiiHost.installPack', () => {
  it('installs a valid archive when adapter.packs.installRoot is configured', async () => {
    const installRoot = await makeTempDir();
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      prompt: async () => true,
      packs: {
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => installRoot,
      },
    });
    const outcome = await createMarkiiHost(adapter).installPack({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
    });
    expect(outcome).toEqual({
      kind: 'installed',
      namespace: 'ana',
      replaced: false,
    });
    expect(lines.length).toBeGreaterThan(0);
  });

  it('refuses a reserved namespace before any prompt', async () => {
    const installRoot = await makeTempDir();
    const seen: string[] = [];
    const adapter = fakeAdapter({
      prompt: async () => {
        seen.push('asked');
        return true;
      },
      packs: {
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(['read']),
        installRoot: () => installRoot,
      },
    });
    const outcome = await createMarkiiHost(adapter).installPack({
      archiveBytes: validArchiveBytes('read'),
    });
    expect(outcome).toEqual({ kind: 'reserved', namespace: 'read' });
    expect(seen).toEqual([]);
  });
});

describe('createMarkiiHost.loadPacks', () => {
  it('discovers over adapter.packs.authorizedFolders()', async () => {
    const folder = await makePackFolder('cat', {
      name: 'cat',
      engine: 'react',
      components: {},
    });
    const adapter = fakeAdapter({
      packs: {
        authorizedFolders: async () => [folder],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadPacks();
    expect(outcome).toEqual({ kind: 'loaded', namespaces: ['cat'] });
  });
});

describe('createMarkiiHost editor behaviors', () => {
  it('completeAt returns completion labels when the adapter has an editor', async () => {
    const adapter = fakeAdapter({
      editor: fakeEditor(':::cal', 0, 6),
    });
    const outcome = await createMarkiiHost(adapter).completeAt({
      line: 0,
      column: 6,
    });
    expect(outcome.kind).toBe('completions');
    if (outcome.kind !== 'completions') throw new Error('expected completions');
    expect(outcome.labels).toContain('callout');
  });

  it('hoverAt returns "none" for a line with no directive', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor('plain', 0, 2) });
    const outcome = await createMarkiiHost(adapter).hoverAt({
      line: 0,
      column: 2,
    });
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('hoverAt returns documentation for a known component', async () => {
    const adapter = fakeAdapter({
      editor: fakeEditor(':::callout', 0, 5),
    });
    const outcome = await createMarkiiHost(adapter).hoverAt({
      line: 0,
      column: 5,
    });
    expect(outcome.kind).toBe('hover');
  });

  it('insertComponent applies an edit for a known standard component', async () => {
    const applied: unknown[] = [];
    const adapter = fakeAdapter({
      editor: {
        ...fakeEditor('', 0, 0),
        applyEdits: async (edits) => {
          applied.push(edits);
          return true;
        },
      },
    });
    const outcome = await createMarkiiHost(adapter).insertComponent({
      name: 'divider',
    });
    expect(outcome.kind).toBe('inserted');
    if (outcome.kind !== 'inserted') throw new Error('expected inserted');
    expect(outcome.cursor).toEqual({ line: 0, column: expect.any(Number) });
    expect(applied).toHaveLength(1);
  });

  it('insertComponent reports not-found for an unknown name, never throwing', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor('', 0, 0) });
    const outcome = await createMarkiiHost(adapter).insertComponent({
      name: 'no-such-component',
    });
    expect(outcome).toEqual({ kind: 'not-found', name: 'no-such-component' });
  });

  it('insertComponent folds in fence-lengthening edits alongside the skeleton, in one applyEdits call', async () => {
    const text = [':::card{}', '', '', ':::'].join('\n');
    const applied: unknown[] = [];
    const adapter = fakeAdapter({
      editor: {
        ...fakeEditor(text, 2, 0),
        applyEdits: async (edits) => {
          applied.push(edits);
          return true;
        },
      },
    });
    const outcome = await createMarkiiHost(adapter).insertComponent({
      name: 'callout',
    });
    expect(outcome.kind).toBe('inserted');
    // One applyEdits call, carrying all three edits (the two lengthened
    // fence lines plus the skeleton insertion) as one undoable edit.
    expect(applied).toHaveLength(1);
    const edits = applied[0] as { line: number; text: string }[];
    expect(edits).toHaveLength(3);
    expect(edits.map((edit) => edit.line)).toEqual([3, 2, 0]);
  });
});
