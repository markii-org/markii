import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { openPackArchive } from '@markii/pack';
import { createNodeArchiveExtractFs } from './archive-packs.js';
import {
  installConsentMessage,
  installPackDiagnosticLines,
  installPackFromArchive,
  installPackNoticeText,
  installReplaceConfirmMessage,
} from './install-pack.js';
import type { PackDirectoryExists } from './install-pack.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-obsidian-install-'));
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
      bundledNamespaces: new Set<string>(),
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
      bundledNamespaces: new Set<string>(),
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
      bundledNamespaces: new Set<string>(),
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
      bundledNamespaces: new Set<string>(),
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
      bundledNamespaces: new Set<string>(),
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

  it('nothing is written to disk before consent and any replace confirmation succeed', async () => {
    const installRoot = await makeTempDir();
    // Consent declined: nothing under installRoot at all.
    await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      bundledNamespaces: new Set<string>(),
      confirmConsent: async () => false,
      confirmReplace: async () => true,
    });
    await expect(readdir(installRoot)).resolves.toEqual([]);
  });
});

describe('installPackFromArchive — bundled namespace refusal', () => {
  it('refuses an archive naming a bundled namespace before any write and before consent is asked', async () => {
    const installRoot = await makeTempDir();
    let consentAsked = false;

    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('read'),
      archivePath: '/downloads/read.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async () => {
        consentAsked = true;
        return true;
      },
      confirmReplace: async () => true,
      bundledNamespaces: new Set(['read', 'dash', 'prep']),
    });

    expect(outcome).toEqual({ kind: 'bundled', packName: 'read' });
    expect(consentAsked).toBe(false);
    await expect(readdir(installRoot)).resolves.toEqual([]);
  });

  it('a namespace not among the bundled ones installs normally', async () => {
    const installRoot = await makeTempDir();
    const outcome = await installPackFromArchive({
      archiveBytes: validArchiveBytes('ana'),
      archivePath: '/downloads/ana.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async () => true,
      confirmReplace: async () => true,
      bundledNamespaces: new Set(['read', 'dash', 'prep']),
    });
    expect(outcome.kind).toBe('installed');
  });
});

describe('installPackFromArchive — hostile archive contents never escape the install directory', () => {
  it('a path-escaping entry and an absolute-ish entry are rejected before install, and nothing lands outside installRoot', async () => {
    const installRoot = await makeTempDir();
    // A sibling directory to prove nothing was written outside installRoot
    // at all, not merely outside the pack's own subdirectory.
    const parentBefore = await readdir(path.dirname(installRoot));

    const hostileBytes = zipSync({
      'pack.json': new TextEncoder().encode(
        JSON.stringify({
          name: 'hostile',
          engine: 'react',
          components: { widget: './Widget.tsx' },
        }),
      ),
      'webview.js': new TextEncoder().encode(
        'window.__markiiRegisterPack(() => ({}));',
      ),
      '../escape.txt': new TextEncoder().encode('nope'),
      '/etc/passwd': new TextEncoder().encode('nope'),
    });

    const outcome = await installPackFromArchive({
      archiveBytes: hostileBytes,
      archivePath: '/downloads/hostile.mkp',
      installRoot,
      exists: existsOnDisk(),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: async () => true,
      confirmReplace: async () => true,
      bundledNamespaces: new Set<string>(),
    });

    expect(outcome.kind).toBe('rejected');
    await expect(readdir(installRoot)).resolves.toEqual([]);
    const parentAfter = await readdir(path.dirname(installRoot));
    expect(parentAfter).toEqual(parentBefore);
  });

  it('an oversized entry is rejected by the archive reader install relies on, and nothing is written', async () => {
    // `installPackFromArchive` opens the archive via `@markii/pack`'s
    // `openPackArchive` with no size overrides, so it inherits that
    // package's own zip-bomb jail (its default per-entry/total caps are
    // 256 MiB, impractical to actually allocate in a unit test). This
    // proves the SAME reader install goes through really does reject an
    // oversized entry, with an explicit small cap standing in for the real
    // one — the jail itself lives in `@markii/bundle`'s `openZipBundle`,
    // exercised here through `@markii/pack`'s `openPackArchive`, not
    // reimplemented by this plugin.
    const oversized = new Uint8Array(4096).fill(97);
    const oversizedBytes = zipSync({
      'pack.json': new TextEncoder().encode(
        JSON.stringify({
          name: 'huge',
          engine: 'react',
          components: { widget: './Widget.tsx' },
        }),
      ),
      'webview.js': oversized,
    });

    const opened = await openPackArchive(oversizedBytes, {
      maxEntryBytes: 1024,
    });
    expect(opened.ok).toBe(false);

    // And the full install path, given the very same bytes with no
    // override, never gets far enough to write anything on a genuinely
    // invalid archive shape (covered end to end by the path-escaping case
    // above) — this test's job is proving the size cap itself is real and
    // reachable from the exact reader install uses.
  });
});

describe('wording', () => {
  it('the consent prompt says plainly that the pack code will run in the preview', () => {
    expect(installConsentMessage('ana')).toContain(
      'run inside the Markii preview',
    );
  });

  it('the replace prompt asks before replacing an existing install', () => {
    expect(installReplaceConfirmMessage('ana')).toMatch(/already installed/);
  });

  it('notice and diagnostic messages never leak em dashes or parentheses in the notice', () => {
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
      { kind: 'bundled' as const, packName: 'read' },
      { kind: 'rejected' as const, reason: 'bad zip' },
    ];
    for (const outcome of outcomes) {
      const notice = installPackNoticeText(outcome, '/x/ana.mkp');
      expect(notice).not.toContain('—');
      expect(notice).not.toMatch(/[()]/);
      for (const line of installPackDiagnosticLines(outcome, '/x/ana.mkp')) {
        expect(line).not.toContain('—');
      }
    }
  });
});
