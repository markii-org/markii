import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { createNodeArchiveExtractFs } from './pack-archive.js';
import {
  installConsentMessage,
  installPackDiagnosticLines,
  installPackFromArchive,
  installPackMessage,
  installReplaceConfirmMessage,
} from './pack-install.js';
import type { PackDirectoryExists } from './pack-install.js';
import type { HostAdapter, HostPromptRequest } from './adapter.js';
import { CLI_LABELS, OBSIDIAN_LABELS, VSCODE_LABELS } from './labels.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-host-install-pack-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function validArchiveBytes(name = 'ana'): Uint8Array {
  const encoder = new TextEncoder();
  return zipSync({
    'pack.json': encoder.encode(
      JSON.stringify({
        name,
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    ),
    'webview.js': encoder.encode('window.__markiiRegisterPack(() => ({}));'),
  });
}

function existsOnDisk(): PackDirectoryExists {
  return async (absolutePath) => {
    try {
      await access(absolutePath);
      return true;
    } catch {
      return false;
    }
  };
}

/** A fake `HostAdapter` whose `prompt` always answers `answer` (default `true`) and records every request. */
function fakeAdapter(
  answer = true,
  seen: HostPromptRequest[] = [],
): HostAdapter {
  return {
    id: 'cli',
    labels: CLI_LABELS,
    readFile: async () => new Uint8Array(),
    exists: async () => false,
    writeFile: async () => {},
    listFolder: async () => [],
    prompt: async (request) => {
      seen.push(request);
      return answer;
    },
    memento: {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      update: () => Promise.resolve(),
    },
    diagnostics: () => {},
    now: () => 1_000,
  };
}

describe('installPackFromArchive', () => {
  it('installs a valid archive after consent, with no existing namespace to replace', async () => {
    const installRoot = await makeTempDir();
    const seen: HostPromptRequest[] = [];

    const outcome = await installPackFromArchive(fakeAdapter(true, seen), {
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(),
    });

    expect(outcome).toEqual({
      kind: 'installed',
      packName: 'ana',
      installedDir: path.join(installRoot, 'ana'),
      replaced: false,
    });
    // Only the consent prompt fires: nothing to replace.
    expect(seen.map((r) => r.kind)).toEqual(['pack-install-consent']);

    const manifestText = await readFile(
      path.join(installRoot, 'ana', 'pack.json'),
      'utf8',
    );
    expect(manifestText).toContain('"ana"');
  });

  it('a rejected archive installs nothing and never asks for consent', async () => {
    const installRoot = await makeTempDir();
    const seen: HostPromptRequest[] = [];

    const outcome = await installPackFromArchive(fakeAdapter(true, seen), {
      archiveBytes: new TextEncoder().encode('not a zip'),
      archivePath: '/downloads/bad.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(),
    });

    expect(outcome.kind).toBe('rejected');
    expect(seen).toEqual([]);
    await expect(access(path.join(installRoot, 'ana'))).rejects.toThrow();
  });

  it('declining consent installs nothing', async () => {
    const installRoot = await makeTempDir();
    const outcome = await installPackFromArchive(fakeAdapter(false), {
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(),
    });
    expect(outcome).toEqual({
      kind: 'declined',
      step: 'consent',
      packName: 'ana',
    });
    await expect(access(path.join(installRoot, 'ana'))).rejects.toThrow();
  });

  it('asks before replacing an already-installed namespace, and declining leaves the existing install untouched', async () => {
    const installRoot = await makeTempDir();
    const existingDir = path.join(installRoot, 'ana');
    const fs = createNodeArchiveExtractFs();
    await fs.makeDirectory(existingDir);
    await fs.writeFile(
      path.join(existingDir, 'pack.json'),
      new TextEncoder().encode('{"marker":"old"}'),
    );

    const seen: HostPromptRequest[] = [];
    // Consent yes, replace no.
    let calls = 0;
    const adapter: HostAdapter = {
      ...fakeAdapter(true),
      prompt: async (request) => {
        seen.push(request);
        calls += 1;
        return request.kind !== 'pack-replace';
      },
    };

    const outcome = await installPackFromArchive(adapter, {
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: fs,
      reservedNamespaces: new Set(),
    });

    expect(calls).toBe(2);
    expect(seen.map((r) => r.kind)).toEqual([
      'pack-install-consent',
      'pack-replace',
    ]);
    expect(outcome).toEqual({
      kind: 'declined',
      step: 'replace',
      packName: 'ana',
    });
    const stillThere = await readFile(
      path.join(existingDir, 'pack.json'),
      'utf8',
    );
    expect(stillThere).toContain('old');
  });

  it('replacing an already-installed namespace overwrites it once confirmed', async () => {
    const installRoot = await makeTempDir();
    const existingDir = path.join(installRoot, 'ana');
    const fs = createNodeArchiveExtractFs();
    await fs.makeDirectory(existingDir);
    await fs.writeFile(
      path.join(existingDir, 'stale.txt'),
      new TextEncoder().encode('stale'),
    );

    const outcome = await installPackFromArchive(fakeAdapter(true), {
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: fs,
      reservedNamespaces: new Set(),
    });

    expect(outcome).toEqual({
      kind: 'installed',
      packName: 'ana',
      installedDir: existingDir,
      replaced: true,
    });
    await expect(access(path.join(existingDir, 'stale.txt'))).rejects.toThrow();
    const manifestText = await readFile(
      path.join(existingDir, 'pack.json'),
      'utf8',
    );
    expect(manifestText).toContain('"ana"');
  });
});

describe('installPackFromArchive — reserved namespace refusal', () => {
  it('refuses an archive naming a reserved namespace before any write and before consent is asked', async () => {
    const installRoot = await makeTempDir();
    const seen: HostPromptRequest[] = [];

    const outcome = await installPackFromArchive(fakeAdapter(true, seen), {
      archiveBytes: validArchiveBytes('read'),
      archivePath: '/downloads/read.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(['read', 'dash', 'prep']),
    });

    expect(outcome).toEqual({ kind: 'reserved', packName: 'read' });
    expect(seen).toEqual([]);
    await expect(access(path.join(installRoot, 'read'))).rejects.toThrow();
  });

  it('a namespace not among the reserved ones installs normally', async () => {
    const installRoot = await makeTempDir();
    const outcome = await installPackFromArchive(fakeAdapter(true), {
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(['read', 'dash', 'prep']),
    });
    expect(outcome.kind).toBe('installed');
  });

  it('an empty reserved set (VS Code) never refuses any namespace', async () => {
    const installRoot = await makeTempDir();
    const outcome = await installPackFromArchive(fakeAdapter(true), {
      archiveBytes: validArchiveBytes('read'),
      archivePath: '/downloads/read.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      reservedNamespaces: new Set(),
    });
    expect(outcome.kind).toBe('installed');
  });
});

describe('wording', () => {
  it('the consent prompt says plainly that the pack code will run in the preview, for every host label set', () => {
    for (const labels of [VSCODE_LABELS, OBSIDIAN_LABELS, CLI_LABELS]) {
      expect(installConsentMessage('ana', labels)).toContain(
        `run inside ${labels.previewNoun}`,
      );
      expect(installConsentMessage('ana', labels)).toContain(
        'from someone you trust',
      );
    }
    expect(installConsentMessage('ana', VSCODE_LABELS)).toContain(
      'the Markii preview',
    );
    expect(installConsentMessage('ana', OBSIDIAN_LABELS)).toContain(
      'the Markii preview',
    );
  });

  it('the replace prompt asks before replacing an existing install', () => {
    expect(installReplaceConfirmMessage('ana')).toMatch(/already installed/);
    expect(installReplaceConfirmMessage('ana')).toContain('removes');
  });

  it("the rejected message names this host's own diagnostics surface", () => {
    const outcome = { kind: 'rejected' as const, reason: 'bad zip' };
    expect(installPackMessage(outcome, '/x/ana.mkp', VSCODE_LABELS)).toBe(
      'Markii: could not install a pack from "/x/ana.mkp". Open the Markii output channel for details.',
    );
    expect(installPackMessage(outcome, '/x/ana.mkp', OBSIDIAN_LABELS)).toBe(
      'Markii: could not install a pack from "/x/ana.mkp". Open the Markii diagnostics for details.',
    );
  });

  it('reloadsAutomatically appends the reload sentence only when true', () => {
    const outcome = {
      kind: 'installed' as const,
      packName: 'ana',
      installedDir: '/x/ana',
      replaced: false,
    };
    expect(
      installPackMessage(outcome, '/x/ana.mkp', VSCODE_LABELS, false),
    ).toBe('Markii: installed pack "ana".');
    expect(
      installPackMessage(outcome, '/x/ana.mkp', OBSIDIAN_LABELS, true),
    ).toBe('Markii: installed pack "ana". Markii packs reloaded.');
  });

  it('result and diagnostic messages never leak em dashes', () => {
    const outcomes = [
      {
        kind: 'installed' as const,
        packName: 'ana',
        installedDir: '/x/ana',
        replaced: false,
      },
      {
        kind: 'installed' as const,
        packName: 'ana',
        installedDir: '/x/ana',
        replaced: true,
      },
      { kind: 'declined' as const, step: 'consent' as const, packName: 'ana' },
      { kind: 'declined' as const, step: 'replace' as const, packName: 'ana' },
      { kind: 'reserved' as const, packName: 'read' },
      { kind: 'rejected' as const, reason: 'bad zip' },
    ];
    for (const outcome of outcomes) {
      expect(
        installPackMessage(outcome, '/x/ana.mkp', VSCODE_LABELS),
      ).not.toContain('—');
      for (const line of installPackDiagnosticLines(outcome, '/x/ana.mkp')) {
        expect(line).not.toContain('—');
      }
    }
  });
});
