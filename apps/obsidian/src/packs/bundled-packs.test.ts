import { describe, expect, it } from 'vitest';
import {
  bundledPackFolderLabel,
  decodeBundledPackAssets,
  resolveBundledPacks,
} from './bundled-packs.js';
import type { BundledPackAsset } from './bundled-packs.js';

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function manifestFor(name: string): string {
  return JSON.stringify({
    name,
    engine: 'react',
    components: { widget: './Widget.tsx' },
  });
}

describe('decodeBundledPackAssets', () => {
  it('decodes the empty placeholder (a dev/Vitest run with no build) to no assets', () => {
    expect(decodeBundledPackAssets('')).toEqual([]);
  });

  it('decodes corrupted base64 to no assets, without throwing', () => {
    expect(decodeBundledPackAssets('!!! not base64 !!!')).toEqual([]);
  });

  it('decodes valid base64 that is not JSON to no assets', () => {
    const base64 = Buffer.from('not json', 'utf8').toString('base64');
    expect(decodeBundledPackAssets(base64)).toEqual([]);
  });

  it('decodes JSON that is not an array to no assets', () => {
    expect(decodeBundledPackAssets(encode({ not: 'an array' }))).toEqual([]);
  });

  it('decodes a well-formed payload into BundledPackAsset entries', () => {
    const payload = [
      {
        name: 'read',
        manifestJson: manifestFor('read'),
        scriptText: 'window.__markiiRegisterPack;',
        cssText: '.mk-read_widget {}',
        luaModules: { 'util.lua': 'return 1' },
      },
    ];
    const assets = decodeBundledPackAssets(encode(payload));
    expect(assets).toEqual([
      {
        name: 'read',
        manifestJson: manifestFor('read'),
        scriptText: 'window.__markiiRegisterPack;',
        cssText: '.mk-read_widget {}',
        luaModules: { 'util.lua': 'return 1' },
      },
    ]);
  });

  it('drops one malformed entry without failing the whole decode', () => {
    const payload = [
      { name: 'ok', manifestJson: manifestFor('ok'), scriptText: 'x' },
      { name: 'missing-script' },
      'not even an object',
    ];
    const assets = decodeBundledPackAssets(encode(payload));
    expect(assets).toHaveLength(1);
    expect(assets[0]!.name).toBe('ok');
    expect(assets[0]!.luaModules).toEqual({});
  });

  it('never lets a poisoned luaModules prototype leak an inherited value in', () => {
    const payload = [
      {
        name: 'ok',
        manifestJson: manifestFor('ok'),
        scriptText: 'x',
        luaModules: { __proto__: { polluted: 'yes' }, 'a.lua': 'return 1' },
      },
    ];
    const assets = decodeBundledPackAssets(encode(payload));
    expect(assets[0]!.luaModules).toEqual({ 'a.lua': 'return 1' });
    expect(Object.hasOwn(assets[0]!.luaModules, 'polluted')).toBe(false);
  });
});

describe('resolveBundledPacks', () => {
  function asset(
    name: string,
    overrides: Partial<BundledPackAsset> = {},
  ): BundledPackAsset {
    return {
      name,
      manifestJson: manifestFor(name),
      scriptText: `/* ${name} */`,
      luaModules: {},
      ...overrides,
    };
  }

  it('resolves a well-formed asset into a DiscoveredPack with a synthetic folder label', () => {
    const { resolved, invalid } = resolveBundledPacks([asset('read')]);
    expect(invalid).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.pack.folder).toBe(bundledPackFolderLabel('read'));
    expect(resolved[0]!.pack.manifest.name).toBe('read');
    expect(resolved[0]!.scriptText).toBe('/* read */');
  });

  it('carries a stylesheet path only when the asset has cssText', () => {
    const withCss = resolveBundledPacks([asset('read', { cssText: '.x {}' })])
      .resolved[0]!;
    expect(withCss.pack.stylesheetPath).toBeDefined();

    const withoutCss = resolveBundledPacks([asset('dash')]).resolved[0]!;
    expect(withoutCss.pack.stylesheetPath).toBeUndefined();
  });

  it('rejects an asset with an invalid manifest, recording why, and excludes it from resolved', () => {
    const { resolved, invalid } = resolveBundledPacks([
      asset('bad', { manifestJson: 'not json' }),
    ]);
    expect(resolved).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toContain('invalid');
  });

  it("rejects a second bundled asset that repeats an earlier one's namespace", () => {
    const { resolved, invalid } = resolveBundledPacks([
      asset('dup'),
      asset('dup'),
    ]);
    expect(resolved).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toContain('duplicated');
  });

  it('never throws for an empty asset list', () => {
    expect(resolveBundledPacks([])).toEqual({ resolved: [], invalid: [] });
  });
});
