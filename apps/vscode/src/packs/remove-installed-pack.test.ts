import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  installedPackQuickPickLabel,
  listInstalledPacks,
  NO_INSTALLED_PACKS_MESSAGE,
  removePackConfirmMessage,
  removePackListEntry,
} from './remove-installed-pack.js';
import type { InstalledPackEntry } from './remove-installed-pack.js';

const INSTALL_ROOT = '/ext/global-storage/installed-packs';

function fakeManifest(name: string, version?: string): string {
  return JSON.stringify({
    name,
    engine: 'react',
    components: { widget: './Widget.tsx' },
    ...(version !== undefined ? { version } : {}),
  });
}

describe('listInstalledPacks', () => {
  it('reads a manifest per subdirectory, sorted by name', async () => {
    const listDirectoryNames = async () => ['cat', 'ana'];
    const readTextFile = async (absolutePath: string) => {
      if (absolutePath === path.join(INSTALL_ROOT, 'ana', 'pack.json')) {
        return fakeManifest('ana', '1.0.0');
      }
      if (absolutePath === path.join(INSTALL_ROOT, 'cat', 'pack.json')) {
        return fakeManifest('cat');
      }
      return undefined;
    };

    const packs = await listInstalledPacks(
      INSTALL_ROOT,
      listDirectoryNames,
      readTextFile,
    );

    expect(packs).toEqual([
      {
        name: 'ana',
        version: '1.0.0',
        directory: path.join(INSTALL_ROOT, 'ana'),
      },
      { name: 'cat', directory: path.join(INSTALL_ROOT, 'cat') },
    ]);
  });

  it('quietly omits a subdirectory with no manifest or an invalid one', async () => {
    const listDirectoryNames = async () => ['empty', 'broken'];
    const readTextFile = async (absolutePath: string) => {
      if (absolutePath.includes('broken')) return '{ not json';
      return undefined;
    };

    const packs = await listInstalledPacks(
      INSTALL_ROOT,
      listDirectoryNames,
      readTextFile,
    );
    expect(packs).toEqual([]);
  });

  it('returns an empty list when the install root has no subdirectories', async () => {
    const packs = await listInstalledPacks(
      INSTALL_ROOT,
      async () => [],
      async () => undefined,
    );
    expect(packs).toEqual([]);
  });
});

describe('installedPackQuickPickLabel', () => {
  it('shows the version alongside the name when present', () => {
    const pack: InstalledPackEntry = {
      name: 'ana',
      version: '1.0.0',
      directory: '/x',
    };
    expect(installedPackQuickPickLabel(pack)).toBe('ana (1.0.0)');
  });

  it('shows just the name when there is no version', () => {
    const pack: InstalledPackEntry = { name: 'ana', directory: '/x' };
    expect(installedPackQuickPickLabel(pack)).toBe('ana');
  });
});

describe('removePackListEntry', () => {
  it('removes the matching entry', () => {
    expect(removePackListEntry(['/a', '/b'], '/a')).toEqual(['/b']);
  });

  it('returns undefined when the entry is not listed', () => {
    expect(removePackListEntry(['/a', '/b'], '/c')).toBeUndefined();
  });
});

describe('messages', () => {
  it('states plainly that removal cannot be undone', () => {
    expect(removePackConfirmMessage({ name: 'ana', directory: '/x' })).toBe(
      'Removing "ana" deletes its installed files and cannot be undone.',
    );
  });

  it('NO_INSTALLED_PACKS_MESSAGE points at the install command', () => {
    expect(NO_INSTALLED_PACKS_MESSAGE).toContain('Install Pack from File');
  });
});
