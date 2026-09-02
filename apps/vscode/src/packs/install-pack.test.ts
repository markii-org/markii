import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { createNodeArchiveExtractFs } from './archive-packs.js';
import {
  installConsentMessage,
  installPackDiagnosticLines,
  installPackFromArchive,
  installPackResultMessage,
  installReplaceConfirmMessage,
} from './install-pack.js';
import type { PackDirectoryExists } from './install-pack.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-install-pack-'));
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

describe('installPackFromArchive', () => {
  it('installs a valid archive after consent, with no existing namespace to replace', async () => {
    const installRoot = await makeTempDir();
    const consentCalls: string[] = [];
    const replaceCalls: string[] = [];

    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async (name) => {
        consentCalls.push(name);
        return true;
      },
      confirmReplace: async (name) => {
        replaceCalls.push(name);
        return true;
      },
    });

    expect(outcome).toEqual({
      kind: 'installed',
      packName: 'ana',
      installedDir: path.join(installRoot, 'ana'),
      replaced: false,
    });
    expect(consentCalls).toEqual(['ana']);
    expect(replaceCalls).toEqual([]); // never asked: nothing to replace

    const manifestText = await readFile(
      path.join(installRoot, 'ana', 'pack.json'),
      'utf8',
    );
    expect(manifestText).toContain('"ana"');
  });

  it('a rejected archive installs nothing and never asks for consent', async () => {
    const installRoot = await makeTempDir();
    let consentAsked = false;

    const outcome = await installPackFromArchive({
      archiveBytes: new TextEncoder().encode('not a zip'),
      archivePath: '/downloads/bad.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async () => {
        consentAsked = true;
        return true;
      },
      confirmReplace: async () => true,
    });

    expect(outcome.kind).toBe('rejected');
    expect(consentAsked).toBe(false);
    await expect(access(path.join(installRoot, 'ana'))).rejects.toThrow();
  });

  it('declining consent installs nothing', async () => {
    const installRoot = await makeTempDir();
    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async () => false,
      confirmReplace: async () => true,
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
    // Pre-existing install under the same namespace.
    const existingDir = path.join(installRoot, 'ana');
    const fs = createNodeArchiveExtractFs();
    await fs.makeDirectory(existingDir);
    await fs.writeFile(
      path.join(existingDir, 'pack.json'),
      new TextEncoder().encode('{"marker":"old"}'),
    );

    let replaceAsked = false;
    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: fs,
      confirmConsent: async () => true,
      confirmReplace: async () => {
        replaceAsked = true;
        return false;
      },
    });

    expect(replaceAsked).toBe(true);
    expect(outcome).toEqual({
      kind: 'declined',
      step: 'replace',
      packName: 'ana',
    });
    // The old install is untouched.
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

    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: fs,
      confirmConsent: async () => true,
      confirmReplace: async () => true,
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

describe('wording', () => {
  it('the consent prompt says plainly that the pack code will run in the preview', () => {
    expect(installConsentMessage('ana')).toContain(
      'run inside every Markii preview',
    );
  });

  it('the replace prompt asks before replacing an existing install', () => {
    expect(installReplaceConfirmMessage('ana')).toMatch(/already installed/);
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
      { kind: 'rejected' as const, reason: 'bad zip' },
    ];
    for (const outcome of outcomes) {
      expect(installPackResultMessage(outcome, '/x/ana.mkp')).not.toContain(
        '—',
      );
      for (const line of installPackDiagnosticLines(outcome, '/x/ana.mkp')) {
        expect(line).not.toContain('—');
      }
    }
  });
});
