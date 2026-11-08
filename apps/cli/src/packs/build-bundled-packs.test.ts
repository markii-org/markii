import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildBundledPacks } from './build-bundled-packs.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fakeRepo(withTerminal: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'markii-cli-bundled-'));
  tempDirs.push(root);
  for (const name of ['read', 'dash', 'prep']) {
    const folder = path.join(root, 'packs', name);
    mkdirSync(folder, { recursive: true });
    const component = withTerminal.includes(name)
      ? { sources: { react: './a.tsx', ansi: './a.ansi.tsx' } }
      : './a.tsx';
    writeFileSync(
      path.join(folder, 'pack.json'),
      JSON.stringify({ name, engine: 'react', components: { a: component } }),
    );
  }
  return root;
}

describe('buildBundledPacks', () => {
  it('builds only the packs that name terminal views, writing terminal.js and an empty webview.js', async () => {
    const repoRoot = fakeRepo(['read']);
    const outDir = path.join(repoRoot, 'out');
    const cacheDir = path.join(repoRoot, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const scriptPath = path.join(cacheDir, 'read-terminal.js');
    writeFileSync(scriptPath, '/* terminal */');

    const built = await buildBundledPacks({
      repoRoot,
      outDir,
      cacheDir,
      buildTerminal: async () => ({ kind: 'built', scriptPath, warnings: [] }),
    });

    expect(built).toEqual(['read']);
    expect(readFileSync(path.join(outDir, 'read', 'terminal.js'), 'utf8')).toBe(
      '/* terminal */',
    );
    expect(
      readFileSync(path.join(outDir, 'read', 'webview.js'), 'utf8'),
    ).toContain('__markiiRegisterPack');
    expect(existsSync(path.join(outDir, 'dash'))).toBe(false);
  });

  it('creates no output folder when no bundled pack has terminal views', async () => {
    const repoRoot = fakeRepo([]);
    const outDir = path.join(repoRoot, 'out');
    const built = await buildBundledPacks({
      repoRoot,
      outDir,
      cacheDir: path.join(repoRoot, 'cache'),
    });
    expect(built).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it('fails loudly when a terminal build fails', async () => {
    const repoRoot = fakeRepo(['dash']);
    await expect(
      buildBundledPacks({
        repoRoot,
        outDir: path.join(repoRoot, 'out'),
        cacheDir: path.join(repoRoot, 'cache'),
        buildTerminal: async () => ({ kind: 'failed', reason: 'boom' }),
      }),
    ).rejects.toThrow('terminal build: boom');
  });
});
