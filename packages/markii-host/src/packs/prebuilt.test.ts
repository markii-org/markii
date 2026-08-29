import { describe, expect, it } from 'vitest';
import {
  PREBUILT_SCRIPT_FILENAME,
  PREBUILT_STYLESHEET_FILENAME,
  prebuiltScriptPathFor,
  prebuiltStylesheetPathFor,
  resolvePrebuiltPack,
} from './prebuilt.js';
import type { PackPathExists } from './prebuilt.js';
import type { DiscoveredPack } from './discover.js';

function packAt(
  folder: string,
  componentPaths: Record<string, string> = {},
): Pick<DiscoveredPack, 'folder' | 'componentPaths' | 'scriptPath'> {
  return {
    folder,
    componentPaths,
    scriptPath: prebuiltScriptPathFor(folder),
  };
}

function existsFrom(present: readonly string[]): PackPathExists {
  const set = new Set(present);
  return (absolutePath) => set.has(absolutePath);
}

describe('prebuiltScriptPathFor / prebuiltStylesheetPathFor', () => {
  it('join the filename constants onto the folder', () => {
    expect(prebuiltScriptPathFor('/packs/ana')).toBe(
      `/packs/ana/${PREBUILT_SCRIPT_FILENAME}`,
    );
    expect(prebuiltStylesheetPathFor('/packs/ana')).toBe(
      `/packs/ana/${PREBUILT_STYLESHEET_FILENAME}`,
    );
  });
});

describe('resolvePrebuiltPack', () => {
  it('resolves to undefined when webview.js does not exist', async () => {
    const pack = packAt('/packs/ana');
    const result = await resolvePrebuiltPack(pack, existsFrom([]));
    expect(result).toBeUndefined();
  });

  it('resolves with no stylesheetPath when webview.js exists but webview.css does not', async () => {
    const pack = packAt('/packs/ana');
    const result = await resolvePrebuiltPack(
      pack,
      existsFrom(['/packs/ana/webview.js']),
    );
    expect(result).toBeDefined();
    expect(result?.scriptPath).toBe('/packs/ana/webview.js');
    expect(result?.stylesheetPath).toBeUndefined();
    expect(result?.shadowedComponentSources).toEqual([]);
  });

  it('resolves with the sibling stylesheet path when both files are present', async () => {
    const pack = packAt('/packs/ana');
    const result = await resolvePrebuiltPack(
      pack,
      existsFrom(['/packs/ana/webview.js', '/packs/ana/webview.css']),
    );
    expect(result?.scriptPath).toBe('/packs/ana/webview.js');
    expect(result?.stylesheetPath).toBe('/packs/ana/webview.css');
  });

  it('lists only the manifest-declared component sources that actually exist on disk', async () => {
    const pack = packAt('/packs/ana', {
      timeline: '/packs/ana/src/Timeline.tsx',
      stat: '/packs/ana/src/Stat.tsx',
    });
    const result = await resolvePrebuiltPack(
      pack,
      existsFrom(['/packs/ana/webview.js', '/packs/ana/src/Timeline.tsx']),
    );
    expect(result?.shadowedComponentSources).toEqual([
      '/packs/ana/src/Timeline.tsx',
    ]);
  });

  it('shadowedComponentSources is empty when the pack ships no sources at all', async () => {
    const pack = packAt('/packs/ana', {
      timeline: '/packs/ana/src/Timeline.tsx',
    });
    const result = await resolvePrebuiltPack(
      pack,
      existsFrom(['/packs/ana/webview.js']),
    );
    expect(result?.shadowedComponentSources).toEqual([]);
  });

  it('treats an exists that throws as "does not exist"', async () => {
    const pack = packAt('/packs/ana', {
      stat: '/packs/ana/src/Stat.tsx',
    });
    const throwingExists: PackPathExists = (absolutePath) => {
      if (absolutePath === '/packs/ana/webview.js') return true;
      throw new Error('boom');
    };
    const result = await resolvePrebuiltPack(pack, throwingExists);
    expect(result).toBeDefined();
    expect(result?.stylesheetPath).toBeUndefined();
    expect(result?.shadowedComponentSources).toEqual([]);
  });

  it('a synchronous exists works exactly like an async one', async () => {
    const pack = packAt('/packs/ana');
    const syncExists: PackPathExists = (absolutePath) =>
      absolutePath === '/packs/ana/webview.js';
    const result = await resolvePrebuiltPack(pack, syncExists);
    expect(result?.scriptPath).toBe('/packs/ana/webview.js');
  });
});
