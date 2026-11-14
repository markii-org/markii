import { createNodeDirectoryLister } from '../node-fs.js';
import { createHtmlExportEngine } from '../html-engine.js';
import { devWorkerIsolate } from '../dev-isolate.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import type { RunResult } from '../run/run-host.js';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import type { HostAdapter, HostEditor } from './adapter.js';
import { CLI_LABELS } from './labels.fixture.js';
import { createMarkiiHost, createMarkiiHostWithSeams } from './create-host.js';

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

/** Real-filesystem `exists`/`readFile`, for a test whose adapter must see real pack folders. */
const realFs: Partial<HostAdapter> = {
  exists: async (p) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  readFile: async (p) => new Uint8Array(await readFile(p)),
  listFolder: createNodeDirectoryLister(),
};

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
      isolate: {
        kind: 'node',
        workerPath: () => '/worker.js',
        spawnIsolate: devWorkerIsolate,
      },
    });
    const host = createMarkiiHostWithSeams(adapter, {
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

describe('createMarkiiHost behaviors that decline never throw and always write a diagnostics line', () => {
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
      'exportLinkedSet',
      () =>
        createMarkiiHost(fakeAdapter()).exportLinkedSet({
          rootPath: '/note.mk.md',
          resolveLink: () => undefined,
          readValues: () => ({}),
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

describe('createMarkiiHost.exportLinkedSet', () => {
  const notes: Record<string, string> = {
    '/v/root.mk.md': '# Root\n\nSee [other](other.mk.md).\n',
    '/v/other.mk.md': '# Other\n',
  };

  function linkedSetAdapter(
    written: Map<string, Uint8Array>,
    lines: string[],
    target: string | null = '/out/root.zip',
  ): HostAdapter {
    return fakeAdapter({
      diagnostics: (line) => lines.push(line),
      readFile: async (p) => {
        const text = notes[p];
        if (text === undefined) throw new Error(`no such note ${p}`);
        return new TextEncoder().encode(text);
      },
      writeFile: async (p, bytes) => {
        written.set(p, bytes);
      },
      exports: {
        formats: new Set(),
        resolveTarget: async () => undefined,
        resolveLinkedSetTarget: async () => target ?? undefined,
      },
    });
  }

  const request = {
    rootPath: '/v/root.mk.md',
    resolveLink: (link: { path: string }) =>
      link.path === 'other.mk.md' ? '/v/other.mk.md' : undefined,
    readValues: () => ({}),
  };

  it('reads notes through the adapter, writes one archive through it, and reports the lines', async () => {
    const written = new Map<string, Uint8Array>();
    const lines: string[] = [];
    const outcome = await createMarkiiHost(linkedSetAdapter(written, lines), {
      htmlEngine: createHtmlExportEngine(),
    }).exportLinkedSet(request);
    if (outcome.kind !== 'exported') throw new Error('expected exported');
    expect(outcome.path).toBe('/out/root.zip');
    expect(outcome.notes.map((note) => note.path)).toEqual([
      '/v/root.mk.md',
      '/v/other.mk.md',
    ]);
    expect([...written.keys()]).toEqual(['/out/root.zip']);
    expect(lines[0]).toContain('Cascade export wrote /out/root.zip');
  });

  it('is unsupported when the host offers no linked-set target', async () => {
    const lines: string[] = [];
    const outcome = await createMarkiiHost(
      fakeAdapter({ diagnostics: (line) => lines.push(line) }),
      { htmlEngine: createHtmlExportEngine() },
    ).exportLinkedSet(request);
    expect(outcome).toMatchObject({
      kind: 'unsupported',
      capability: 'linked-set-export',
    });
    expect(lines).toHaveLength(1);
  });

  it('is declined, not thrown, when the picker declines', async () => {
    const written = new Map<string, Uint8Array>();
    const lines: string[] = [];
    const outcome = await createMarkiiHost(
      linkedSetAdapter(written, lines, null),
      { htmlEngine: createHtmlExportEngine() },
    ).exportLinkedSet(request);
    expect(outcome).toEqual({ kind: 'declined' });
    expect(written.size).toBe(0);
    expect(lines).toHaveLength(1);
  });

  it('reports a failed write with its path and reason on the diagnostics surface', async () => {
    const lines: string[] = [];
    const adapter = linkedSetAdapter(new Map(), lines);
    const outcome = await createMarkiiHost(
      {
        ...adapter,
        writeFile: async () => {
          throw new Error('disk full');
        },
      },
      { htmlEngine: createHtmlExportEngine() },
    ).exportLinkedSet(request);
    expect(outcome).toEqual({
      kind: 'failed',
      path: '/out/root.zip',
      reason: 'disk full',
    });
    expect(lines).toEqual([
      'Cascade export failed to /out/root.zip: disk full',
    ]);
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
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportNote({
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

  it('threads the render options through and reports what the document held', async () => {
    const written: Uint8Array[] = [];
    const adapter = fakeAdapter({
      writeFile: async (_p, bytes) => {
        written.push(bytes);
      },
      exports: {
        formats: new Set(['html']),
        resolveTarget: async (name) => `/exports/${name}`,
      },
    });
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportNote({
      format: 'html',
      notePath: '/note.mk.md',
      text: '# hello\n\n```lua {name=calc}\nreturn 1\n```\n',
      renderBody: async () => ({ ok: true, html: '<h1>from the host</h1>' }),
      packStylesheets: [{ namespace: 'ana', cssText: '.x { color: red; }' }],
      packCount: 1,
    });
    if (outcome.kind !== 'exported') throw new Error('expected exported');
    expect(outcome.valueCount).toBe(0);
    expect(outcome.hasScripts).toBe(true);
    expect(outcome.render).toEqual({
      engine: 'react',
      packCount: 1,
      stylesheetCount: 1,
    });
    const html = new TextDecoder().decode(written[0]);
    expect(html).toContain('from the host');
    expect(html).toContain('.x { color: red; }');
  });

  it('is declined, not thrown, when the picker declines', async () => {
    const adapter = fakeAdapter({
      exports: {
        formats: new Set(['html']),
        resolveTarget: async () => undefined,
      },
    });
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportNote({
      format: 'html',
      notePath: '/note.mk.md',
      text: '# hello',
    });
    expect(outcome).toEqual({ kind: 'declined' });
  });
});

describe('createMarkiiHost.installPack', () => {
  it('installs a valid archive when adapter.packs.installRoot is configured', async () => {
    const installRoot = await makeTempDir();
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      prompt: async () => true,
      writeFile: async (file, bytes) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
      },
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => installRoot,
        removeFolder: (folder) => rm(folder, { recursive: true, force: true }),
      },
    });
    const outcome = await createMarkiiHost(adapter).installPack({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
    });
    expect(outcome).toEqual({
      kind: 'installed',
      namespace: 'ana',
      installedDir: path.join(installRoot, 'ana'),
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
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(['read']),
        installRoot: () => installRoot,
        removeFolder: async () => {},
      },
    });
    const outcome = await createMarkiiHost(adapter).installPack({
      archiveBytes: validArchiveBytes('read'),
    });
    expect(outcome).toEqual({ kind: 'reserved', namespace: 'read' });
    expect(seen).toEqual([]);
  });
});

describe('createMarkiiHost.installPack without removeFolder', () => {
  it('is unsupported and writes a diagnostics line', async () => {
    const installRoot = await makeTempDir();
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => installRoot,
      },
    });
    const outcome = await createMarkiiHost(adapter).installPack({
      archiveBytes: validArchiveBytes('ana'),
    });
    expect(outcome.kind).toBe('unsupported');
    expect(lines.length).toBeGreaterThan(0);
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
      ...realFs,
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [folder],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadPacks();
    expect(outcome).toMatchObject({ kind: 'loaded', namespaces: ['cat'] });
  });
});

describe('createMarkiiHost.loadTerminalPacks', () => {
  async function terminalPack(
    name: string,
    withScript: boolean,
  ): Promise<string> {
    const folder = await makePackFolder(name, {
      name,
      engine: 'react',
      components: {
        meter: { sources: { react: './M.tsx', ansi: './M.ansi.tsx' } },
      },
    });
    if (withScript) await writeFile(path.join(folder, 'terminal.js'), '/*t*/');
    return folder;
  }

  it('is unsupported unless the pack source declares the ansi engine', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadTerminalPacks();
    expect(outcome.kind).toBe('unsupported');
    expect(lines.length).toBe(1);
  });

  it('reads terminal.js, and reports a missing one as a failure line and a diagnostics line', async () => {
    const ok = await terminalPack('ana', true);
    const missing = await terminalPack('bob', false);
    const lines: string[] = [];
    const adapter = fakeAdapter({
      ...realFs,
      diagnostics: (line) => lines.push(line),
      packs: {
        trust: 'none',
        engine: 'ansi',
        authorizedFolders: async () => [ok, missing],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadTerminalPacks();
    if (outcome.kind !== 'loaded') throw new Error('expected loaded');
    expect(outcome.scripts.map((script) => script.namespace)).toEqual(['ana']);
    expect(outcome.scripts[0]?.text).toBe('/*t*/');
    expect(outcome.failureLines).toEqual([
      expect.stringContaining(
        'Pack "bob" names terminal views but ships no terminal.js',
      ),
    ]);
    expect(
      lines.some((line) => line.includes('Pack "bob" names terminal')),
    ).toBe(true);
    expect(lines.some((line) => line.includes('Loaded pack "ana"'))).toBe(true);
  });

  it('treats a react-only pack as an expected engine skip, not a failure', async () => {
    const folder = await makePackFolder('rx', {
      name: 'rx',
      engine: 'react',
      components: { a: './A.tsx' },
    });
    const adapter = fakeAdapter({
      ...realFs,
      packs: {
        trust: 'none',
        engine: 'ansi',
        authorizedFolders: async () => [folder],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadTerminalPacks();
    if (outcome.kind !== 'loaded') throw new Error('expected loaded');
    expect(outcome.packs).toEqual([]);
    expect(outcome.failureLines).toEqual([]);
    expect(outcome.skipped[0]?.engineUnsupported).toEqual({
      packName: 'rx',
      components: [{ directive: 'rx_a', pack: 'rx', engines: ['react'] }],
    });
    expect(outcome.unavailable).toEqual([
      { directive: 'rx_a', pack: 'rx', engines: ['react'] },
    ]);
    expect(outcome.components).toEqual(outcome.unavailable);
  });

  it('lists only the components of a partly supported pack that lack a view', async () => {
    const folder = await makePackFolder('mix', {
      name: 'mix',
      engine: 'react',
      components: {
        a: './A.tsx',
        b: { sources: { react: './B.tsx', ansi: './b.ts' } },
      },
    });
    const adapter = fakeAdapter({
      ...realFs,
      packs: {
        trust: 'none',
        engine: 'ansi',
        authorizedFolders: async () => [folder],
        reservedNamespaces: () => new Set(),
      },
    });
    const outcome = await createMarkiiHost(adapter).loadPacks();
    if (outcome.kind !== 'loaded') throw new Error('expected loaded');
    expect(outcome.packs).toHaveLength(1);
    expect(outcome.unavailable).toEqual([
      { directive: 'mix_a', pack: 'mix', engines: ['react'] },
    ]);
    expect(outcome.components.map((c) => c.directive)).toEqual([
      'mix_a',
      'mix_b',
    ]);
  });
});

describe('createMarkiiHost.removePack', () => {
  it('removes the namespace folder under the install root and nothing else', async () => {
    const installRoot = await makeTempDir();
    await mkdir(path.join(installRoot, 'ana'));
    await mkdir(path.join(installRoot, 'bob'));
    const removed: string[] = [];
    const adapter = fakeAdapter({
      ...realFs,
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(['read']),
        installRoot: () => installRoot,
        removeFolder: async (folder) => {
          removed.push(folder);
        },
      },
    });
    const host = createMarkiiHost(adapter);
    expect(await host.removePack('ana')).toEqual({
      kind: 'removed',
      namespace: 'ana',
    });
    expect(removed).toEqual([path.join(installRoot, 'ana')]);
    expect((await host.removePack('zed')).kind).toBe('not-installed');
    expect((await host.removePack('read')).kind).toBe('reserved');
  });

  it('refuses a namespace that is not a plain pack name, before building any path', async () => {
    const adapter = fakeAdapter({
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => '/store',
        removeFolder: async () => {
          throw new Error('must not be called');
        },
      },
    });
    const host = createMarkiiHost(adapter);
    for (const bad of ['../x', 'a/b', '', '.', 'A b']) {
      expect((await host.removePack(bad)).kind).toBe('invalid');
    }
  });

  it('is unsupported without removeFolder', async () => {
    const adapter = fakeAdapter({
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => '/store',
      },
    });
    expect((await createMarkiiHost(adapter).removePack('ana')).kind).toBe(
      'unsupported',
    );
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

  it('completeAt carries the replace span, the filter start, and no fence edits for a top-level opener', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor(':::cal', 0, 6) });
    const outcome = await createMarkiiHost(adapter).completeAt({
      line: 0,
      column: 6,
    });
    if (outcome.kind !== 'completions') throw new Error('expected completions');
    expect(outcome.replaceStart).toBe(0);
    expect(outcome.replaceEnd).toBe(6);
    expect(outcome.tokenStart).toBe(3);
    expect(outcome.items.length).toBeGreaterThan(0);
    expect(outcome.fenceEdits).toEqual([]);
  });

  it('completeAt reads the request document when one is given, not the editor', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor('plain', 0, 0) });
    const outcome = await createMarkiiHost(adapter).completeAt({
      line: 0,
      column: 6,
      documentText: ':::cal',
    });
    expect(outcome.kind).toBe('completions');
  });

  it('completeAt says "none" for a bare colon run that closes an open container', async () => {
    const text = ':::callout\ntext\n:::';
    const adapter = fakeAdapter({ editor: fakeEditor(text, 2, 3) });
    const outcome = await createMarkiiHost(adapter).completeAt({
      line: 2,
      column: 3,
    });
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('completeAt returns fence edits for a container opened inside a container', async () => {
    const text = ':::card\n:::cal\n:::';
    const adapter = fakeAdapter({ editor: fakeEditor(text, 1, 6) });
    const outcome = await createMarkiiHost(adapter).completeAt({
      line: 1,
      column: 6,
    });
    if (outcome.kind !== 'completions') throw new Error('expected completions');
    expect(outcome.fenceEdits.length).toBeGreaterThan(0);
    expect(outcome.fenceEdits.every((edit) => edit.line !== 1)).toBe(true);
  });

  it('completeAtSync answers from the standard set cold, and sees packs once warm', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor(':::cal', 0, 6) });
    const host = createMarkiiHost(adapter);
    const cold = host.completeAtSync({ line: 0, column: 6 });
    expect(cold.kind).toBe('completions');
    await host.completeAt({ line: 0, column: 6 });
    expect(host.completeAtSync({ line: 0, column: 6 }).kind).toBe(
      'completions',
    );
    host.invalidateCatalog();
  });

  it('hoverAt carries the structured documentation and the name range', async () => {
    const adapter = fakeAdapter({ editor: fakeEditor(':::callout', 0, 5) });
    const outcome = await createMarkiiHost(adapter).hoverAt({
      line: 0,
      column: 5,
    });
    if (outcome.kind !== 'hover') throw new Error('expected hover');
    expect(outcome.documentation.summary.length).toBeGreaterThan(0);
    expect(outcome.start).toBeLessThan(outcome.end);
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

describe('createMarkiiHost.run never rejects', () => {
  const nodeIsolate = {
    kind: 'node' as const,
    workerPath: () => '/worker.js',
    spawnIsolate: devWorkerIsolate,
  };

  it('resolves failed, with the diagnostics line and a failed trace, when the isolate throws', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      isolate: nodeIsolate,
      now: () => 7,
      diagnostics: (line) => lines.push(line),
    });
    const host = createMarkiiHostWithSeams(adapter, {
      spawnRun: async () => {
        throw new Error('isolate exploded');
      },
    });
    const outcome = await host.run({
      documentKey: 'doc-throws',
      text: 'text',
      trigger: 'manual',
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'isolate exploded' });
    expect(lines).toEqual([
      'manual run failed before it could report: isolate exploded',
    ]);
    expect(host.lastRun('doc-throws').trace).toEqual({
      trigger: 'manual',
      ranAt: 7,
      ok: false,
      reason: 'isolate exploded',
    });
  });
});

describe('createMarkiiHost.lastRun and forgetGrants', () => {
  const nodeIsolate = {
    kind: 'node' as const,
    workerPath: () => '/worker.js',
    spawnIsolate: devWorkerIsolate,
  };
  const note = ['```lua {name=total}', 'return 1', '```', ''].join('\n');

  it('is empty when nothing is stored', () => {
    const host = createMarkiiHost(fakeAdapter());
    expect(host.lastRun('never-ran')).toEqual({
      values: {},
      persistedValues: {},
    });
  });

  it('returns the values a run stored, stale-marked for showing, and the raw ones for an export', async () => {
    const adapter = fakeAdapter({ isolate: nodeIsolate, now: () => 11 });
    const host = createMarkiiHostWithSeams(adapter, {
      spawnRun: async () => ({
        values: { total: { status: 'fresh', value: 3 } },
        failures: [],
        cacheSnapshot: {},
      }),
    });
    await host.run({ documentKey: 'doc-a', text: note, trigger: 'manual' });
    const last = host.lastRun('doc-a');
    expect(last.values['total']).toMatchObject({ status: 'stale', value: 3 });
    expect(last.persistedValues['total']).toMatchObject({
      status: 'fresh',
      value: 3,
    });
    expect(last.trace).toEqual({ trigger: 'manual', ranAt: 11, ok: true });
    expect(host.lastRun('doc-b')).toEqual({ values: {}, persistedValues: {} });
  });

  it('forgetGrants clears the stored grant so the next run prompts again', async () => {
    const prompts: string[] = [];
    const adapter = fakeAdapter({
      isolate: nodeIsolate,
      prompt: async (request) => {
        prompts.push(request.kind);
        return true;
      },
    });
    const host = createMarkiiHostWithSeams(adapter, {
      spawnRun: async () => ({ values: {}, failures: [], cacheSnapshot: {} }),
    });
    const netNote =
      '```lua {name=total}\nreturn net.fetch_json("https://api.example.com/orders")\n```\n';
    await host.run({ documentKey: 'doc-g', text: netNote, trigger: 'manual' });
    await host.run({ documentKey: 'doc-g', text: netNote, trigger: 'manual' });
    expect(prompts).toEqual(['grant-host']);
    await host.forgetGrants('doc-g');
    await host.run({ documentKey: 'doc-g', text: netNote, trigger: 'manual' });
    expect(prompts).toEqual(['grant-host', 'grant-host']);
    await expect(host.forgetGrants('doc-unknown')).resolves.toBeUndefined();
  });
});

describe('export targetPath', () => {
  const written = (): {
    map: Map<string, Uint8Array>;
    adapter: HostAdapter;
    asked: string[];
  } => {
    const map = new Map<string, Uint8Array>();
    const asked: string[] = [];
    const adapter = fakeAdapter({
      readFile: async (p) =>
        new TextEncoder().encode(
          p === '/v/root.mk.md' ? '# Root\n' : '# Other\n',
        ),
      writeFile: async (p, bytes) => {
        map.set(p, bytes);
      },
      exports: {
        formats: new Set(['html']),
        resolveLinkedSetTarget: async (name) => {
          asked.push(name);
          return '/picked/root.zip';
        },
      },
    });
    return { map, adapter, asked };
  };

  it('a single-note export writes to targetPath with no resolveTarget declared', async () => {
    const { map, adapter } = written();
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportNote({
      format: 'html',
      notePath: '/v/root.mk.md',
      text: '# Root',
      targetPath: '/chosen/out.html',
    });
    expect(outcome.kind).toBe('exported');
    expect([...map.keys()]).toEqual(['/chosen/out.html']);
  });

  it('a single-note export with no resolveTarget and no targetPath is unsupported', async () => {
    const { adapter } = written();
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportNote({
      format: 'html',
      notePath: '/v/root.mk.md',
      text: '# Root',
    });
    expect(outcome.kind).toBe('unsupported');
  });

  it('a linked-set export skips the resolver when targetPath is present', async () => {
    const { map, adapter, asked } = written();
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportLinkedSet({
      rootPath: '/v/root.mk.md',
      resolveLink: () => undefined,
      readValues: () => ({}),
      targetPath: '/given/root.zip',
    });
    expect(outcome.kind).toBe('exported');
    expect(asked).toEqual([]);
    expect([...map.keys()]).toEqual(['/given/root.zip']);
  });

  it('a linked-set export with exports declared but no resolver and no targetPath is unsupported', async () => {
    const adapter = fakeAdapter({
      exports: { formats: new Set(['html']) },
    });
    const outcome = await createMarkiiHost(adapter, {
      htmlEngine: createHtmlExportEngine(),
    }).exportLinkedSet({
      rootPath: '/v/root.mk.md',
      resolveLink: () => undefined,
      readValues: () => ({}),
    });
    expect(outcome).toMatchObject({
      kind: 'unsupported',
      capability: 'linked-set-export',
    });
  });
});

describe('createMarkiiHost behaviors resolve `failed` when an adapter primitive rejects', () => {
  const boom = async (): Promise<never> => {
    throw new Error('boom');
  };

  function rejectingPacks(
    overrides: Partial<NonNullable<HostAdapter['packs']>> = {},
  ): NonNullable<HostAdapter['packs']> {
    return {
      trust: 'none',
      engine: 'ansi',
      authorizedFolders: boom,
      reservedNamespaces: () => new Set(),
      ...overrides,
    };
  }

  it('loadPacks', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      packs: rejectingPacks(),
    });
    const outcome = await createMarkiiHost(adapter).loadPacks();
    expect(outcome).toEqual({ kind: 'failed', reason: 'boom' });
    expect(lines).toEqual(['load packs failed: boom']);
  });

  it('loadTerminalPacks', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      packs: rejectingPacks(),
    });
    const outcome = await createMarkiiHost(adapter).loadTerminalPacks();
    expect(outcome).toEqual({ kind: 'failed', reason: 'boom' });
    expect(lines).toEqual(['load terminal packs failed: boom']);
  });

  it('installedPacks', async () => {
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      packs: rejectingPacks({
        trust: 'device-list',
        installRoot: () => {
          throw new Error('boom');
        },
      }),
    });
    const outcome = await createMarkiiHost(adapter).installedPacks();
    expect(outcome).toEqual({ kind: 'failed', reason: 'boom' });
    expect(lines).toEqual(['list installed packs failed: boom']);
  });

  it('completeAt and hoverAt when the editor rejects', async () => {
    const lines: string[] = [];
    const editor: HostEditor = {
      ...fakeEditor(':::cal', 0, 6),
      documentText: () => {
        throw new Error('boom');
      },
    };
    const host = createMarkiiHost(
      fakeAdapter({ diagnostics: (line) => lines.push(line), editor }),
    );
    expect(await host.completeAt({ line: 0, column: 6 })).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
    expect(await host.hoverAt({ line: 0, column: 6 })).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
    expect(lines).toEqual(['completion failed: boom', 'hover failed: boom']);
  });

  it('completeAt and completeAtSync still answer, and say why, when the pack read rejects', async () => {
    const lines: string[] = [];
    const host = createMarkiiHost(
      fakeAdapter({
        diagnostics: (line) => lines.push(line),
        editor: fakeEditor(':::cal', 0, 6),
        packs: rejectingPacks(),
      }),
    );
    expect((await host.completeAt({ line: 0, column: 6 })).kind).toBe(
      'completions',
    );
    expect(lines).toEqual(['read the pack catalog failed: boom']);
  });

  it('completeAtSync returns none and writes a line when the editor throws', () => {
    const lines: string[] = [];
    const editor: HostEditor = {
      ...fakeEditor(':::cal', 0, 6),
      documentText: () => {
        throw new Error('boom');
      },
    };
    const host = createMarkiiHost(
      fakeAdapter({ diagnostics: (line) => lines.push(line), editor }),
    );
    expect(host.completeAtSync({ line: 0, column: 6 })).toEqual({
      kind: 'none',
    });
    expect(lines).toEqual(['completion failed: boom']);
  });

  it('insertComponent when the pack read rejects, and when applyEdits rejects', async () => {
    const lines: string[] = [];
    const rejectedRead = createMarkiiHost(
      fakeAdapter({
        diagnostics: (line) => lines.push(line),
        editor: fakeEditor('', 0, 0),
        packs: rejectingPacks(),
      }),
    );
    expect(await rejectedRead.insertComponent({ name: 'callout' })).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
    const rejectedEdit = createMarkiiHost(
      fakeAdapter({
        diagnostics: (line) => lines.push(line),
        editor: { ...fakeEditor('', 0, 0), applyEdits: boom },
      }),
    );
    expect(await rejectedEdit.insertComponent({ name: 'callout' })).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
    expect(lines).toEqual([
      'insert component failed: boom',
      'insert component failed: boom',
    ]);
  });

  it('insertComponent carries a reason when the host declines the edit', async () => {
    const outcome = await createMarkiiHost(
      fakeAdapter({
        editor: { ...fakeEditor('', 0, 0), applyEdits: async () => false },
      }),
    ).insertComponent({ name: 'callout' });
    expect(outcome.kind).toBe('failed');
    expect(outcome).toHaveProperty('reason');
  });
});
