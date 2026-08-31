import { describe, expect, it } from 'vitest';
import { packExportStylesheets } from './pack-export-styles.js';
import type { DiscoveredPack } from '@markii/host';

function pack(overrides: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    folder: '/packs/demo',
    manifest: { name: 'demo', engine: 'react', components: {} },
    componentPaths: {},
    scriptsDir: '/packs/demo/scripts',
    scriptPath: '/packs/demo/webview.js',
    ...overrides,
  } as DiscoveredPack;
}

describe('packExportStylesheets', () => {
  it('reads a stylesheet for a pack that has one', async () => {
    const packs = [pack({ stylesheetPath: '/packs/demo/webview.css' })];
    const sheets = await packExportStylesheets(packs, async (path) => {
      expect(path).toBe('/packs/demo/webview.css');
      return '.mk-demo { color: red; }';
    });
    expect(sheets).toEqual([
      { namespace: 'demo', cssText: '.mk-demo { color: red; }' },
    ]);
  });

  it('skips a pack with no stylesheetPath at all', async () => {
    const packs = [pack()];
    const sheets = await packExportStylesheets(packs, async () => {
      throw new Error('should not be called');
    });
    expect(sheets).toEqual([]);
  });

  it('skips a pack whose stylesheet cannot be read, without throwing', async () => {
    const packs = [
      pack({
        manifest: { name: 'broken', engine: 'react', components: {} },
        stylesheetPath: '/packs/broken/webview.css',
      }),
      pack({ stylesheetPath: '/packs/demo/webview.css' }),
    ];
    const sheets = await packExportStylesheets(packs, async (path) => {
      if (path === '/packs/broken/webview.css') {
        throw new Error('ENOENT');
      }
      return '.mk-demo {}';
    });
    expect(sheets).toEqual([{ namespace: 'demo', cssText: '.mk-demo {}' }]);
  });

  it('preserves pack order', async () => {
    const packs = [
      pack({
        manifest: { name: 'first', engine: 'react', components: {} },
        stylesheetPath: '/packs/first/webview.css',
      }),
      pack({
        manifest: { name: 'second', engine: 'react', components: {} },
        stylesheetPath: '/packs/second/webview.css',
      }),
    ];
    const sheets = await packExportStylesheets(packs, async (path) =>
      path.includes('first') ? 'a' : 'b',
    );
    expect(sheets.map((sheet) => sheet.namespace)).toEqual(['first', 'second']);
  });
});
