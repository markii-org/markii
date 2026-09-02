import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createNodeArchiveExtractFs,
  writeArchiveContents,
} from './archive-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-archive-packs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('writeArchiveContents + createNodeArchiveExtractFs', () => {
  it('writes pack.json, webview.js, webview.css and nested scripts/ modules', async () => {
    const workDir = await makeTempDir();
    const target = path.join(workDir, 'out');
    const fs = createNodeArchiveExtractFs();

    await writeArchiveContents(
      {
        manifest: { name: 'ana', engine: 'react', components: {} },
        manifestWarnings: [],
        scriptBytes: new TextEncoder().encode('script'),
        stylesheetBytes: new TextEncoder().encode('style'),
        scriptModules: {
          'http.lua': new TextEncoder().encode('return {}'),
          'nested/sub.lua': new TextEncoder().encode('return 1'),
        },
        ignoredEntries: [],
      },
      target,
      fs,
    );

    expect(await readFile(path.join(target, 'pack.json'), 'utf8')).toContain(
      '"ana"',
    );
    expect(await readFile(path.join(target, 'webview.js'), 'utf8')).toBe(
      'script',
    );
    expect(await readFile(path.join(target, 'webview.css'), 'utf8')).toBe(
      'style',
    );
    expect(
      await readFile(path.join(target, 'scripts', 'http.lua'), 'utf8'),
    ).toBe('return {}');
    expect(
      await readFile(path.join(target, 'scripts', 'nested', 'sub.lua'), 'utf8'),
    ).toBe('return 1');
  });
});
