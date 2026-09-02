import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import {
  installedPackQuickPickLabel,
  listInstalledPacks,
  NO_INSTALLED_PACKS_MESSAGE,
  removeInstalledPack,
  removeInstalledPackDiagnosticLines,
  removeInstalledPackResultMessage,
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

describe('removeInstalledPack', () => {
  const pack: InstalledPackEntry = {
    name: 'ana',
    directory: '/ext/global-storage/installed-packs/ana',
  };

  it('removes the directory once confirmed', async () => {
    const removeDirectory = vi.fn(async () => {});
    const outcome = await removeInstalledPack({
      pack,
      removeDirectory,
      confirmRemove: async () => true,
    });
    expect(outcome).toEqual({
      kind: 'removed',
      packName: 'ana',
      directory: pack.directory,
    });
    expect(removeDirectory).toHaveBeenCalledWith(pack.directory);
  });

  it('declines without touching disk when the user says no', async () => {
    const removeDirectory = vi.fn(async () => {});
    const outcome = await removeInstalledPack({
      pack,
      removeDirectory,
      confirmRemove: async () => false,
    });
    expect(outcome).toEqual({ kind: 'declined', packName: 'ana' });
    expect(removeDirectory).not.toHaveBeenCalled();
  });

  it('reports a failed delete without throwing', async () => {
    const outcome = await removeInstalledPack({
      pack,
      removeDirectory: async () => {
        throw new Error('EPERM');
      },
      confirmRemove: async () => true,
    });
    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'EPERM',
    });
  });

  it('reports a thrown confirmation without throwing', async () => {
    const outcome = await removeInstalledPack({
      pack,
      removeDirectory: async () => {},
      confirmRemove: async () => {
        throw new Error('dialog closed');
      },
    });
    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'dialog closed',
    });
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

  it('formats each outcome kind', () => {
    expect(
      removeInstalledPackResultMessage({
        kind: 'removed',
        packName: 'ana',
        directory: '/x',
      }),
    ).toBe('Markii: removed pack "ana".');
    expect(
      removeInstalledPackResultMessage({ kind: 'declined', packName: 'ana' }),
    ).toBe('Markii: pack removal cancelled. Nothing was removed.');
    expect(
      removeInstalledPackResultMessage({
        kind: 'failed',
        packName: 'ana',
        reason: 'EPERM',
      }),
    ).toBe(
      'Markii: could not remove pack "ana". Open the Markii output for details.',
    );
  });

  it('diagnostic lines carry the reason and directory', () => {
    expect(
      removeInstalledPackDiagnosticLines({
        kind: 'removed',
        packName: 'ana',
        directory: '/x',
      }),
    ).toEqual(['Remove Installed Pack removed pack "ana" from /x.']);
    expect(
      removeInstalledPackDiagnosticLines({
        kind: 'failed',
        packName: 'ana',
        reason: 'EPERM',
      }),
    ).toEqual(['Remove Installed Pack failed for "ana": EPERM']);
  });

  it('NO_INSTALLED_PACKS_MESSAGE points at the install command', () => {
    expect(NO_INSTALLED_PACKS_MESSAGE).toContain('Install Pack from File');
  });
});
