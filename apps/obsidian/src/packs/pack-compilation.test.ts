import { describe, expect, it, vi } from 'vitest';
import {
  createPackRegistrationBuilder,
  packCompilationAvailable,
} from './pack-compilation.js';
import type { DiscoveredPack, PackBuildOutcome } from '@markii/host';

function pack(name: string): DiscoveredPack {
  return {
    folder: `/packs/${name}`,
    manifest: { name, engine: 'react', components: {} },
    componentPaths: {},
    scriptsDir: `/packs/${name}/scripts`,
    scriptPath: `/packs/${name}/webview.js`,
  };
}

describe('packCompilationAvailable', () => {
  it('is true only when both paths are present', () => {
    expect(packCompilationAvailable('a', 'b')).toBe(true);
    expect(packCompilationAvailable(undefined, 'b')).toBe(false);
    expect(packCompilationAvailable('a', undefined)).toBe(false);
    expect(packCompilationAvailable(undefined, undefined)).toBe(false);
  });
});

describe('createPackRegistrationBuilder', () => {
  it('delegates to the injected compile and returns its outcome verbatim when both paths are present', async () => {
    const outcome: PackBuildOutcome = {
      kind: 'built',
      scriptPath: '/cache/ana/webview.js',
      stylesheetPath: undefined,
      warnings: [],
    };
    const compile = vi.fn().mockResolvedValue(outcome);
    const builder = createPackRegistrationBuilder({
      esbuildBrowserModulePath: '/plugin/esbuild-wasm/lib/browser.js',
      esbuildWasmBinaryPath: '/plugin/esbuild-wasm/esbuild.wasm',
      compile,
    });

    const result = await builder(pack('ana'), '/cache');

    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(pack('ana'), '/cache');
    expect(result).toBe(outcome);
  });

  it('resolves a failed outcome naming the pack, without calling compile, when the browser module path is missing', async () => {
    const compile = vi.fn();
    const builder = createPackRegistrationBuilder({
      esbuildBrowserModulePath: undefined,
      esbuildWasmBinaryPath: '/plugin/esbuild-wasm/esbuild.wasm',
      compile,
    });

    const result = await builder(pack('ana'), '/cache');

    expect(compile).not.toHaveBeenCalled();
    expect(result.kind).toBe('failed');
    expect((result as { kind: 'failed'; reason: string }).reason).toContain(
      'ana',
    );
  });

  it('resolves a failed outcome naming the pack, without calling compile, when the wasm binary path is missing', async () => {
    const compile = vi.fn();
    const builder = createPackRegistrationBuilder({
      esbuildBrowserModulePath: '/plugin/esbuild-wasm/lib/browser.js',
      esbuildWasmBinaryPath: undefined,
      compile,
    });

    const result = await builder(pack('gh'), '/cache');

    expect(compile).not.toHaveBeenCalled();
    expect(result.kind).toBe('failed');
    expect((result as { kind: 'failed'; reason: string }).reason).toContain(
      'gh',
    );
  });

  it('resolves a failed outcome without calling compile when both paths are missing', async () => {
    const compile = vi.fn();
    const builder = createPackRegistrationBuilder({
      esbuildBrowserModulePath: undefined,
      esbuildWasmBinaryPath: undefined,
      compile,
    });

    const result = await builder(pack('ana'), '/cache');

    expect(compile).not.toHaveBeenCalled();
    expect(result.kind).toBe('failed');
  });
});
