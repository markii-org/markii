/**
 * An executed test against the REAL bundled packs (`packs/read`,
 * `packs/dash`, `packs/prep` at the repo root) and the real esbuild-wasm
 * compiler, not a fake `build` function — a broken bundled pack source
 * must fail loudly, and only a real compile catches that (matching
 * `@markii/host`'s own `pack-build.fixture.test.ts` posture). Slower than
 * an ordinary unit test (esbuild-wasm's one-time initialization plus three
 * real compiles), so it gets a longer timeout.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildBundledPacks,
  BUNDLED_PACK_NAMES,
} from './build-bundled-packs.js';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('buildBundledPacks', () => {
  it('compiles every bundled pack into outDir/<name>/ with pack.json and webview.js', async () => {
    const outDir = await mkdtemp(
      path.join(tmpdir(), 'markii-bundled-packs-out-'),
    );
    const cacheDir = await mkdtemp(
      path.join(tmpdir(), 'markii-bundled-packs-cache-'),
    );
    tempDirs.push(outDir, cacheDir);

    await buildBundledPacks({ repoRoot, outDir, cacheDir });

    for (const name of BUNDLED_PACK_NAMES) {
      const packDir = path.join(outDir, name);
      const manifestPath = path.join(packDir, 'pack.json');
      const scriptPath = path.join(packDir, 'webview.js');
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(scriptPath)).toBe(true);

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        name: string;
      };
      expect(manifest.name).toBe(name);

      const script = await readFile(scriptPath, 'utf8');
      expect(script).toContain('__markiiRegisterPack');
    }
  }, 30000);

  it('throws when a bundled pack folder does not exist', async () => {
    const outDir = await mkdtemp(
      path.join(tmpdir(), 'markii-bundled-packs-missing-out-'),
    );
    const cacheDir = await mkdtemp(
      path.join(tmpdir(), 'markii-bundled-packs-missing-cache-'),
    );
    tempDirs.push(outDir, cacheDir);

    await expect(
      buildBundledPacks({
        repoRoot: path.join(repoRoot, 'does-not-exist'),
        outDir,
        cacheDir,
      }),
    ).rejects.toThrow(/failed to discover/);
  }, 30000);
});
