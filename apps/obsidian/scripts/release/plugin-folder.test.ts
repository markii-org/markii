import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REQUIRED_PLUGIN_FILES,
  assemblePluginFolder,
  listFilesRecursively,
} from './plugin-folder.ts';

let workDir: string;
let appDir: string;
let outDir: string;

function writeDistFiles(distDir: string): void {
  mkdirSync(join(distDir, 'esbuild-wasm', 'lib'), { recursive: true });
  writeFileSync(join(distDir, 'main.js'), 'console.log("main");');
  writeFileSync(
    join(distDir, 'esbuild-wasm', 'lib', 'browser.js'),
    'console.log("esbuild");',
  );
  writeFileSync(
    join(distDir, 'esbuild-wasm', 'esbuild.wasm'),
    'fake-esbuild-wasm',
  );
}

function writeFakeAppDir(dir: string): void {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ id: 'markii', version: '0.2.0' }),
  );
  writeFileSync(dir + '/styles.css', '.doc { color: red; }');
  writeDistFiles(join(dir, 'dist'));
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'markii-plugin-folder-'));
  appDir = join(workDir, 'app');
  outDir = join(workDir, 'out');
  mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('listFilesRecursively', () => {
  it('lists nested files as sorted POSIX-style relative paths', () => {
    mkdirSync(join(appDir, 'a', 'b'), { recursive: true });
    writeFileSync(join(appDir, 'top.txt'), 'x');
    writeFileSync(join(appDir, 'a', 'mid.txt'), 'x');
    writeFileSync(join(appDir, 'a', 'b', 'deep.txt'), 'x');

    expect(listFilesRecursively(appDir)).toEqual([
      'a/b/deep.txt',
      'a/mid.txt',
      'top.txt',
    ]);
  });
});

describe('assemblePluginFolder', () => {
  it('assembles a flattened plugin folder named after manifest id', () => {
    writeFakeAppDir(appDir);

    const result = assemblePluginFolder({ appDir, outDir });

    expect(result.pluginDir).toBe(join(outDir, 'markii'));
    for (const required of REQUIRED_PLUGIN_FILES) {
      expect(result.files).toContain(required);
    }
    expect(result.files.sort()).toEqual([...REQUIRED_PLUGIN_FILES].sort());
  });

  it('throws naming the missing required file', () => {
    writeFakeAppDir(appDir);
    rmSync(join(appDir, 'dist', 'esbuild-wasm', 'esbuild.wasm'));

    expect(() => assemblePluginFolder({ appDir, outDir })).toThrow(
      /esbuild\.wasm/,
    );
  });

  it('throws a clear error when dist/ is missing', () => {
    writeFileSync(
      join(appDir, 'manifest.json'),
      JSON.stringify({ id: 'markii' }),
    );
    writeFileSync(join(appDir, 'styles.css'), '.doc {}');

    expect(() => assemblePluginFolder({ appDir, outDir })).toThrow(
      /npm run build -w markii-obsidian/,
    );
  });

  it('throws a clear error when styles.css is missing', () => {
    writeFileSync(
      join(appDir, 'manifest.json'),
      JSON.stringify({ id: 'markii' }),
    );
    writeDistFiles(join(appDir, 'dist'));

    expect(() => assemblePluginFolder({ appDir, outDir })).toThrow(
      /generate:doc-css/,
    );
  });
});
