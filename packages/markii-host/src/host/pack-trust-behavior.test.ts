import { describe, expect, it } from 'vitest';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import type { HostAdapter, HostPackSource } from './adapter.js';
import { CLI_LABELS } from './labels.js';
import { createMarkiiHost } from './create-host.js';
import { PACK_TRUST_STORAGE_KEY } from '../packs/pack-trust.js';
import { selectEnabledPacks } from './pack-trust-behavior.js';

const ROOT = '/install';

function memoryMemento(): GrantMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get<T>(key: string, defaultValue?: T): T {
      return store.has(key) ? (store.get(key) as T) : (defaultValue as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

/** An adapter over an in-memory file map, so no real disk is involved. */
function trustAdapter(options: {
  trust?: HostPackSource['trust'];
  files?: Record<string, string>;
  answers?: boolean[];
  reserved?: string[];
}) {
  const files = new Map(Object.entries(options.files ?? {}));
  const lines: string[] = [];
  const asked: string[] = [];
  const memento = memoryMemento();
  const answers = [...(options.answers ?? [])];
  const adapter: HostAdapter = {
    id: 'obsidian',
    labels: CLI_LABELS,
    readFile: async (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error('ENOENT');
      return new TextEncoder().encode(text);
    },
    exists: async (p) =>
      files.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    writeFile: async (p, bytes) => {
      files.set(p, new TextDecoder().decode(bytes));
    },
    listFolder: async (dir) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(`${dir}/`)) continue;
        const rest = key.slice(dir.length + 1);
        const slash = rest.indexOf('/');
        names.add(slash === -1 ? rest : rest.slice(0, slash));
      }
      return [...names].map((name) => ({
        name,
        isDirectory: files.has(`${dir}/${name}/pack.json`),
      }));
    },
    prompt: async (request) => {
      asked.push(request.message);
      return answers.shift() ?? false;
    },
    memento,
    diagnostics: (line) => lines.push(line),
    now: () => 0,
    packs: {
      engine: 'react',
      ...(options.trust !== undefined ? { trust: options.trust } : {}),
      authorizedFolders: async () => [],
      reservedNamespaces: () => new Set(options.reserved ?? []),
      installRoot: () => ROOT,
      removeFolder: async (folder) => {
        for (const key of [...files.keys()]) {
          if (key.startsWith(`${folder}/`)) files.delete(key);
        }
      },
    },
  };
  return { adapter, files, lines, asked, memento };
}

function pack(name: string, version = '1.0.0'): Record<string, string> {
  return {
    [`${ROOT}/${name}/pack.json`]: JSON.stringify({
      name,
      version,
      engine: 'react',
      components: { widget: './Widget.tsx' },
    }),
  };
}

describe('selectEnabledPacks', () => {
  it('splits the namespaces on disk by the trust list', () => {
    const result = selectEnabledPacks('/root', ['read', 'mystery'], {
      entries: [{ namespace: 'read', version: '1.0.0' }],
    });
    expect(result.enabled).toEqual([
      { namespace: 'read', folder: '/root/read', version: '1.0.0' },
    ]);
    expect(result.notEnabled).toEqual(['mystery']);
  });

  it('a trusted namespace no longer on disk contributes to neither list', () => {
    const result = selectEnabledPacks('/root', [], {
      entries: [{ namespace: 'deleted' }],
    });
    expect(result).toEqual({ enabled: [], notEnabled: [] });
  });
});

describe('the trust list is a host behavior', () => {
  it('is unsupported, with a diagnostics line, on a host that does not declare it', async () => {
    for (const trust of [undefined, 'none'] as const) {
      const { adapter, lines } = trustAdapter({
        ...(trust !== undefined ? { trust } : {}),
        files: pack('ana'),
      });
      const host = createMarkiiHost(adapter);
      expect(await host.installedPacks()).toMatchObject({
        kind: 'unsupported',
        capability: 'pack-trust',
      });
      expect(await host.enablePack('ana')).toMatchObject({
        kind: 'unsupported',
      });
      expect(await host.disablePack('ana')).toMatchObject({
        kind: 'unsupported',
      });
      expect(lines.filter((l) => l.includes('pack-trust'))).toHaveLength(3);
    }
  });

  it('loads only the trusted installed folders, and reports the other as present', async () => {
    const { adapter, lines } = trustAdapter({
      trust: 'device-list',
      files: { ...pack('ana'), ...pack('sneaky') },
    });
    adapter.memento.update(PACK_TRUST_STORAGE_KEY, {
      entries: [{ namespace: 'ana', version: '1.0.0' }],
    });
    const host = createMarkiiHost(adapter);
    const outcome = await host.loadPacks();
    expect(outcome.kind).toBe('loaded');
    if (outcome.kind !== 'loaded') return;
    expect(outcome.namespaces).toEqual(['ana']);
    expect(
      lines.some((l) => l.includes('"sneaky" is present but not enabled')),
    ).toBe(true);
  });

  it('a folder arriving without a trust entry is never read by discovery', async () => {
    const { adapter } = trustAdapter({
      trust: 'device-list',
      files: pack('sneaky'),
    });
    const read: string[] = [];
    const original = adapter.readFile;
    adapter.readFile = async (p) => {
      read.push(p);
      return original(p);
    };
    await createMarkiiHost(adapter).loadPacks();
    expect(read.filter((p) => p.includes('sneaky'))).toEqual([]);
  });

  it('enable asks the install consent prompt, then trusts the folder with its version', async () => {
    const { adapter, asked, memento } = trustAdapter({
      trust: 'device-list',
      files: pack('ana', '2.1.0'),
      answers: [true],
    });
    const host = createMarkiiHost(adapter);
    expect(await host.enablePack('ana')).toEqual({
      kind: 'enabled',
      namespace: 'ana',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('lets its code run');
    expect(memento.store.get(PACK_TRUST_STORAGE_KEY)).toEqual({
      entries: [{ namespace: 'ana', version: '2.1.0' }],
    });
    const listed = await host.installedPacks();
    expect(listed).toMatchObject({
      kind: 'listed',
      enabled: [{ namespace: 'ana', version: '2.1.0' }],
      notEnabled: [],
    });
  });

  it('a refused consent prompt trusts nothing', async () => {
    const { adapter, memento, lines } = trustAdapter({
      trust: 'device-list',
      files: pack('ana'),
      answers: [false],
    });
    const outcome = await createMarkiiHost(adapter).enablePack('ana');
    expect(outcome).toEqual({ kind: 'declined', namespace: 'ana' });
    expect(memento.store.has(PACK_TRUST_STORAGE_KEY)).toBe(false);
    expect(lines.some((l) => l.startsWith('Enable pack declined'))).toBe(true);
  });

  it('enable refuses a missing folder, a reserved namespace and a bad name', async () => {
    const { adapter } = trustAdapter({
      trust: 'device-list',
      reserved: ['read'],
      answers: [true, true, true],
    });
    const host = createMarkiiHost(adapter);
    expect((await host.enablePack('ghost')).kind).toBe('not-installed');
    expect((await host.enablePack('read')).kind).toBe('reserved');
    expect((await host.enablePack('../etc')).kind).toBe('invalid');
  });

  it('disable withdraws the entry and leaves the folder in place', async () => {
    const { adapter, files } = trustAdapter({
      trust: 'device-list',
      files: pack('ana'),
      answers: [true],
    });
    const host = createMarkiiHost(adapter);
    await host.enablePack('ana');
    expect(await host.disablePack('ana')).toEqual({
      kind: 'disabled',
      namespace: 'ana',
    });
    expect(files.has(`${ROOT}/ana/pack.json`)).toBe(true);
    expect(await host.disablePack('ana')).toEqual({
      kind: 'not-enabled',
      namespace: 'ana',
    });
    expect(await host.installedPacks()).toMatchObject({
      enabled: [],
      notEnabled: ['ana'],
    });
  });

  it('remove withdraws the trust entry even when the folder was already gone', async () => {
    const { adapter, memento } = trustAdapter({
      trust: 'device-list',
      files: pack('ana'),
      answers: [true],
    });
    const host = createMarkiiHost(adapter);
    await host.enablePack('ana');
    expect((await host.removePack('ana')).kind).toBe('removed');
    expect(memento.store.get(PACK_TRUST_STORAGE_KEY)).toEqual({ entries: [] });
    // The folder is gone but a stale entry is simply dropped on a second call.
    await memento.update(PACK_TRUST_STORAGE_KEY, {
      entries: [{ namespace: 'ana' }],
    });
    expect((await host.removePack('ana')).kind).toBe('not-installed');
    expect(memento.store.get(PACK_TRUST_STORAGE_KEY)).toEqual({ entries: [] });
  });

  it('a hostile stored value reads as an empty list, so nothing loads', async () => {
    const { adapter } = trustAdapter({
      trust: 'device-list',
      files: pack('ana'),
    });
    await adapter.memento.update(PACK_TRUST_STORAGE_KEY, 'not a list');
    expect(await createMarkiiHost(adapter).installedPacks()).toMatchObject({
      enabled: [],
      notEnabled: ['ana'],
    });
  });
});
