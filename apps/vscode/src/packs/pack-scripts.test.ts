import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { loadPackModules } from './pack-scripts.js';
import type { PackScriptsReader } from './pack-scripts.js';
import type { DiscoveredPack } from './discover.js';

function pack(name: string, scriptsDir: string): DiscoveredPack {
  return {
    folder: path.dirname(scriptsDir),
    manifest: { name, engine: 'react', components: {} },
    componentPaths: {},
    scriptsDir,
    webviewScriptPath: path.join(path.dirname(scriptsDir), 'webview.js'),
  };
}

/** An in-memory directory tree: absolute dir -> entries, absolute file -> text. */
function fakeReader(
  dirs: Record<string, Array<{ name: string; isDirectory: boolean }>>,
  files: Record<string, string>,
): PackScriptsReader {
  return {
    async readDirectory(dir) {
      return dirs[dir] ?? [];
    },
    async readFile(file) {
      return files[file];
    },
  };
}

describe('loadPackModules', () => {
  it('reads a flat scripts/ directory into the module map', async () => {
    const scriptsDir = '/packs/demo/scripts';
    const reader = fakeReader(
      { [scriptsDir]: [{ name: 'http.lua', isDirectory: false }] },
      { [path.join(scriptsDir, 'http.lua')]: 'return {}' },
    );

    const map = await loadPackModules([pack('demo', scriptsDir)], reader);

    expect(map.demo).toEqual({ 'http.lua': 'return {}' });
  });

  it('recurses into subdirectories, building jailed relative paths', async () => {
    const scriptsDir = '/packs/demo/scripts';
    const nestedDir = path.join(scriptsDir, 'nested');
    const reader = fakeReader(
      {
        [scriptsDir]: [{ name: 'nested', isDirectory: true }],
        [nestedDir]: [{ name: 'util.lua', isDirectory: false }],
      },
      { [path.join(nestedDir, 'util.lua')]: 'return 1' },
    );

    const map = await loadPackModules([pack('demo', scriptsDir)], reader);

    expect(map.demo).toEqual({ 'nested/util.lua': 'return 1' });
  });

  it('ignores non-.lua files and a missing scripts/ directory', async () => {
    const scriptsDir = '/packs/demo/scripts';
    const reader = fakeReader(
      { [scriptsDir]: [{ name: 'readme.txt', isDirectory: false }] },
      {},
    );

    const map = await loadPackModules([pack('demo', scriptsDir)], reader);
    expect(map.demo).toEqual({});

    const missingDirReader = fakeReader({}, {});
    const mapMissing = await loadPackModules(
      [pack('demo', '/packs/demo/scripts')],
      missingDirReader,
    );
    expect(mapMissing.demo).toEqual({});
  });

  it('skips an unreadable individual file without failing the whole pack', async () => {
    const scriptsDir = '/packs/demo/scripts';
    const reader = fakeReader(
      {
        [scriptsDir]: [
          { name: 'ok.lua', isDirectory: false },
          { name: 'broken.lua', isDirectory: false },
        ],
      },
      { [path.join(scriptsDir, 'ok.lua')]: 'return 1' },
    );

    const map = await loadPackModules([pack('demo', scriptsDir)], reader);
    expect(map.demo).toEqual({ 'ok.lua': 'return 1' });
  });

  it('produces an entry per pack, empty for one with no scripts', async () => {
    const reader = fakeReader({}, {});
    const map = await loadPackModules(
      [pack('a', '/packs/a/scripts'), pack('b', '/packs/b/scripts')],
      reader,
    );
    expect(Object.keys(map).sort()).toEqual(['a', 'b']);
  });
});
