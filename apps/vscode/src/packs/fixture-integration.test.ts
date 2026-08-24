import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { spawnRun } from '../run/run-host.js';
import { discoverPacks, createNodeFileReader } from './discover.js';
import { loadPackModules } from './pack-scripts.js';

/**
 * End-to-end coverage of the pack-loading pieces (GitHub issue #3 slice 5)
 * against the exemplar fixture pack at
 * `test-fixtures/packs/demo/` — a REAL folder on disk with a real
 * `pack.json`, `webview.js`, and `scripts/util.lua`, proving discovery,
 * manifest validation, and the Lua `require` path all work together on an
 * actual pack shape, not just synthetic in-memory fakes.
 *
 * The webview registration half (`../webview/pack-registry.ts`) is covered
 * separately in `../webview/pack-registry.test.ts`, which loads this SAME
 * fixture's `webview.js` into a real jsdom `window`.
 */
const FIXTURE_ROOT = path.resolve(
  import.meta.dirname,
  '../../test-fixtures/packs',
);
const DEMO_PACK_DIR = path.join(FIXTURE_ROOT, 'demo');
const WORKER_PATH = path.join(import.meta.dirname, '../run/worker-entry.ts');

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

describe('exemplar pack fixture — discovery', () => {
  it('discovers the real demo pack folder and validates its manifest', async () => {
    const result = await discoverPacks([DEMO_PACK_DIR], createNodeFileReader());

    expect(result.skipped).toEqual([]);
    expect(result.collisions).toEqual([]);
    expect(result.packs).toHaveLength(1);
    const pack = result.packs[0]!;
    expect(pack.manifest).toEqual({
      name: 'demo',
      engine: 'react',
      components: { badge: './Badge.tsx' },
    });
    expect(pack.componentPaths.badge).toBe(
      path.join(DEMO_PACK_DIR, 'Badge.tsx'),
    );
    expect(pack.webviewScriptPath).toBe(path.join(DEMO_PACK_DIR, 'webview.js'));
  });
});

describe('exemplar pack fixture — Lua module loading + require', () => {
  it('loads scripts/util.lua from the real fixture into a PackModulesMap', async () => {
    const { packs } = await discoverPacks(
      [DEMO_PACK_DIR],
      createNodeFileReader(),
    );
    const modules = await loadPackModules(packs);

    expect(Object.keys(modules)).toEqual(['demo']);
    expect(modules.demo?.['util.lua']).toContain('greet');
  });

  it('a real worker run can require "demo/util" and call its function', async () => {
    const { packs } = await discoverPacks(
      [DEMO_PACK_DIR],
      createNodeFileReader(),
    );
    const packModules = await loadPackModules(packs);

    const text = fence(
      'a',
      'local util = require "demo/util"\nreturn util.greet("world")',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      packModules,
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('hello, world');
  });
});

describe('exemplar pack fixture — webview.js is well-formed', () => {
  it('is present on disk and calls window.__markiiRegisterPack', () => {
    const source = readFileSync(path.join(DEMO_PACK_DIR, 'webview.js'), 'utf8');
    expect(source).toContain('__markiiRegisterPack');
    expect(source).toContain('__markiiReact');
  });
});
