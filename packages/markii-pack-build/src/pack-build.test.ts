import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildPackRegistrationScript, computeCacheKey } from './pack-build.js';
import type { PackBuildOptions, PackBuildSource } from './pack-build.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-pack-build-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function packFor(folder: string): PackBuildSource {
  return {
    folder,
    manifest: {
      name: 'fakepack',
      engine: 'react',
      components: { stat: './Stat.tsx' },
    },
    componentPaths: { stat: path.join(folder, 'Stat.tsx') },
  };
}

/** A fake `build` that counts invocations and returns a fixed, well-formed IIFE — lets cache-hit/miss and wiring be tested fast, without paying for a real esbuild-wasm invocation (that path is covered separately, against the real thing, in `pack-build.fixture.test.ts`). */
function fakeBuild(outputText = '(function(){})();'): {
  build: NonNullable<PackBuildOptions['build']>;
  callCount: () => number;
} {
  let calls = 0;
  const build: NonNullable<PackBuildOptions['build']> = async () => {
    calls += 1;
    return {
      errors: [],
      warnings: [],
      outputFiles: [
        {
          text: outputText,
          path: '<stdout>',
          contents: new Uint8Array(),
          hash: '',
        },
      ],
      mangleCache: undefined,
      metafile: undefined,
    } as unknown as Awaited<ReturnType<NonNullable<PackBuildOptions['build']>>>;
  };
  return { build, callCount: () => calls };
}

function readerFor(files: Record<string, string>) {
  return async (absolutePath: string) => files[absolutePath];
}

/** Like `fakeBuild`, but the fake response also carries a `.css` output file (as esbuild really does, script first) — for testing the stylesheet-emission wiring without a real esbuild-wasm invocation. */
function fakeBuildWithCss(
  scriptText: string,
  cssText: string,
): {
  build: NonNullable<PackBuildOptions['build']>;
  callCount: () => number;
} {
  let calls = 0;
  const build: NonNullable<PackBuildOptions['build']> = async () => {
    calls += 1;
    return {
      errors: [],
      warnings: [],
      outputFiles: [
        {
          text: scriptText,
          path: '<stdout>.js',
          contents: new Uint8Array(),
          hash: '',
        },
        {
          text: cssText,
          path: '<stdout>.css',
          contents: new Uint8Array(),
          hash: '',
        },
      ],
      mangleCache: undefined,
      metafile: undefined,
    } as unknown as Awaited<ReturnType<NonNullable<PackBuildOptions['build']>>>;
  };
  return { build, callCount: () => calls };
}

describe('computeCacheKey', () => {
  it('changes when a component source byte changes', () => {
    const pack = packFor('/packs/fakepack');
    const keyA = computeCacheKey(
      pack,
      new Map([[pack.componentPaths.stat!, 'a']]),
    );
    const keyB = computeCacheKey(
      pack,
      new Map([[pack.componentPaths.stat!, 'b']]),
    );
    expect(keyA).not.toBe(keyB);
  });

  it('is stable for the same manifest and sources', () => {
    const pack = packFor('/packs/fakepack');
    const sources = new Map([[pack.componentPaths.stat!, 'same']]);
    expect(computeCacheKey(pack, sources)).toBe(computeCacheKey(pack, sources));
  });

  it('does not depend on the Map insertion order', () => {
    const pack: PackBuildSource = {
      ...packFor('/packs/fakepack'),
      manifest: {
        name: 'fakepack',
        engine: 'react',
        components: { a: './A.tsx', b: './B.tsx' },
      },
      componentPaths: {
        a: '/packs/fakepack/A.tsx',
        b: '/packs/fakepack/B.tsx',
      },
    };
    const forward = new Map([
      ['/packs/fakepack/A.tsx', 'aaa'],
      ['/packs/fakepack/B.tsx', 'bbb'],
    ]);
    const backward = new Map([
      ['/packs/fakepack/B.tsx', 'bbb'],
      ['/packs/fakepack/A.tsx', 'aaa'],
    ]);
    expect(computeCacheKey(pack, forward)).toBe(
      computeCacheKey(pack, backward),
    );
  });
});

describe('buildPackRegistrationScript', () => {
  it('never throws and reports a failure when a component source is missing', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const { build } = fakeBuild();

    const outcome = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({}), // nothing readable
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.reason).toContain('stat');
    }
  });

  it('writes a cache file and returns its path on a successful build', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const { build } = fakeBuild('(function(){ /* built */ })();');

    const outcome = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.stat!]: 'export function Stat(){}',
      }),
    });

    expect(outcome.kind).toBe('built');
    if (outcome.kind === 'built') {
      expect(outcome.scriptPath.startsWith(cacheDir)).toBe(true);
      const written = await readFile(outcome.scriptPath, 'utf8');
      expect(written).toBe('(function(){ /* built */ })();');
    }
  });

  it('bakes manifest-declared inline kinds into the registration entry, defaulting others to block form', async () => {
    // Regression for the hardcoded `inline: false` that made every
    // `kind: "inline"` pack component render as the form-mismatch
    // fallback: the synthetic entry must carry a truthful per-component
    // inline map derived from the manifest.
    const cacheDir = await makeTempDir();
    const folder = '/packs/kinds';
    const pack: PackBuildSource = {
      folder,
      manifest: {
        name: 'kinds',
        engine: 'react',
        components: {
          badge: { source: './Badge.tsx', kind: 'inline' },
          stat: { source: './Stat.tsx', kind: 'leaf' },
          plain: './Plain.tsx',
        },
      },
      componentPaths: {
        badge: path.join(folder, 'Badge.tsx'),
        stat: path.join(folder, 'Stat.tsx'),
        plain: path.join(folder, 'Plain.tsx'),
      },
    };

    let entryContents: string | undefined;
    const build: NonNullable<PackBuildOptions['build']> = async (options) => {
      entryContents = (options as { stdin?: { contents?: string } }).stdin
        ?.contents;
      const { build: inner } = fakeBuild();
      return inner(options);
    };

    const outcome = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.badge!]: 'export function Badge(){}',
        [pack.componentPaths.stat!]: 'export function Stat(){}',
        [pack.componentPaths.plain!]: 'export function Plain(){}',
      }),
    });

    expect(outcome.kind).toBe('built');
    expect(entryContents).toBeDefined();
    expect(entryContents).toContain('var __markiiInline = {"badge":true};');
    expect(entryContents).toContain(
      'inline: __markiiInline[__markiiLocalName] === true',
    );
    // Only the declared-inline component appears in the map: leaf and
    // kind-less entries fall through to `=== true` being false.
    expect(entryContents).not.toContain('"stat":true');
    expect(entryContents).not.toContain('"plain":true');
  });

  it('a second build with identical sources is a cache hit and never calls build() again', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const { build, callCount } = fakeBuild();
    const readComponentSource = readerFor({
      [pack.componentPaths.stat!]: 'export function Stat(){}',
    });

    const first = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource,
    });
    expect(first.kind).toBe('built');
    expect(callCount()).toBe(1);

    const second = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource,
    });
    expect(second.kind).toBe('built');
    expect(callCount()).toBe(1); // no second esbuild invocation
    if (first.kind === 'built' && second.kind === 'built') {
      expect(second.scriptPath).toBe(first.scriptPath);
    }
  });

  it('changing a source byte is a cache miss and triggers a second build', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const { build, callCount } = fakeBuild();

    const first = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.stat!]: 'export function Stat(){ return 1; }',
      }),
    });
    const second = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.stat!]: 'export function Stat(){ return 2; }',
      }),
    });

    expect(first.kind).toBe('built');
    expect(second.kind).toBe('built');
    expect(callCount()).toBe(2);
    if (first.kind === 'built' && second.kind === 'built') {
      expect(second.scriptPath).not.toBe(first.scriptPath);
    }
  });

  it('reports a failure (never throws) when the build itself throws', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const build: NonNullable<PackBuildOptions['build']> = async () => {
      throw new Error('esbuild exploded');
    };

    const outcome = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.stat!]: 'export function Stat(){}',
      }),
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.reason).toContain('esbuild exploded');
    }
  });

  it('reports a failure when the build reports errors and produces no output', async () => {
    const cacheDir = await makeTempDir();
    const pack = packFor('/packs/fakepack');
    const build: NonNullable<PackBuildOptions['build']> = async () =>
      ({
        errors: [{ text: 'Unexpected token' }],
        warnings: [],
        outputFiles: [],
      }) as unknown as Awaited<
        ReturnType<NonNullable<PackBuildOptions['build']>>
      >;

    const outcome = await buildPackRegistrationScript(pack, cacheDir, {
      build,
      readComponentSource: readerFor({
        [pack.componentPaths.stat!]: 'this is not valid js(((',
      }),
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.reason).toContain('Unexpected token');
    }
  });

  describe('pack CSS', () => {
    it('a pack with no CSS import emits no stylesheet', async () => {
      const cacheDir = await makeTempDir();
      const pack = packFor('/packs/fakepack');
      const { build } = fakeBuild();

      const outcome = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]: 'export function Stat(){}',
        }),
      });

      expect(outcome.kind).toBe('built');
      if (outcome.kind === 'built') {
        expect(outcome.stylesheetPath).toBeUndefined();
        expect(outcome.warnings).toEqual([]);
      }
    });

    it('a pack that imports CSS emits a stylesheet sibling of the script, with the same cache-key base name', async () => {
      const cacheDir = await makeTempDir();
      const pack = packFor('/packs/fakepack');
      const cssPath = path.join('/packs/fakepack', 'x.css');
      const { build } = fakeBuildWithCss(
        '(function(){})();',
        '.mk-fakepack_row { color: var(--mk-fg); }',
      );

      const outcome = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]:
            "import './x.css';\nexport function Stat(){}",
          [cssPath]: '.mk-fakepack_row { color: var(--mk-fg); }',
        }),
      });

      expect(outcome.kind).toBe('built');
      if (outcome.kind === 'built') {
        expect(outcome.stylesheetPath).toBeDefined();
        const base = outcome.scriptPath.replace(/\.js$/, '');
        expect(outcome.stylesheetPath).toBe(`${base}.css`);
        const written = await readFile(outcome.stylesheetPath!, 'utf8');
        expect(written).toBe('.mk-fakepack_row { color: var(--mk-fg); }');
        expect(outcome.warnings).toEqual([]);
      }
    });

    it('surfaces lint warnings for the emitted stylesheet', async () => {
      const cacheDir = await makeTempDir();
      const pack = packFor('/packs/fakepack');
      const cssPath = path.join('/packs/fakepack', 'x.css');
      const { build } = fakeBuildWithCss(
        '(function(){})();',
        '.row { background: #fff; }',
      );

      const outcome = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]:
            "import './x.css';\nexport function Stat(){}",
          [cssPath]: '.row { background: #fff; }',
        }),
      });

      expect(outcome.kind).toBe('built');
      if (outcome.kind === 'built') {
        expect(outcome.warnings.length).toBeGreaterThanOrEqual(2);
        expect(
          outcome.warnings.some((w) => w.includes('raw color literal')),
        ).toBe(true);
        expect(
          outcome.warnings.some((w) => w.includes('required prefix')),
        ).toBe(true);
      }
    });

    it('a CSS-only content change is a cache miss and re-lints/rewrites the stylesheet', async () => {
      const cacheDir = await makeTempDir();
      const pack = packFor('/packs/fakepack');
      const cssPath = path.join('/packs/fakepack', 'x.css');
      const componentSource = "import './x.css';\nexport function Stat(){}";
      const { build, callCount } = fakeBuildWithCss(
        '(function(){})();',
        '.mk-fakepack_row { color: var(--mk-fg); }',
      );

      const first = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]: componentSource,
          [cssPath]: '.mk-fakepack_row { color: var(--mk-fg); }',
        }),
      });
      expect(callCount()).toBe(1);

      const second = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]: componentSource,
          [cssPath]: '.mk-fakepack_row { color: var(--mk-fg); padding: 4px; }',
        }),
      });
      expect(callCount()).toBe(2); // CSS-only change still busts the cache

      expect(first.kind).toBe('built');
      expect(second.kind).toBe('built');
      if (first.kind === 'built' && second.kind === 'built') {
        expect(second.scriptPath).not.toBe(first.scriptPath);
        expect(second.stylesheetPath).not.toBe(first.stylesheetPath);
      }
    });

    it('a cache hit re-reads and re-lints the cached stylesheet from disk', async () => {
      const cacheDir = await makeTempDir();
      const pack = packFor('/packs/fakepack');
      const cssPath = path.join('/packs/fakepack', 'x.css');
      const { build, callCount } = fakeBuildWithCss(
        '(function(){})();',
        '.row { color: #123456; }',
      );
      const readComponentSource = readerFor({
        [pack.componentPaths.stat!]:
          "import './x.css';\nexport function Stat(){}",
        [cssPath]: '.row { color: #123456; }',
      });

      const first = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource,
      });
      expect(callCount()).toBe(1);
      expect(first.kind).toBe('built');
      if (first.kind === 'built') expect(first.warnings.length).toBe(2);

      const second = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource,
      });
      expect(callCount()).toBe(1); // still a cache hit, no second esbuild call
      expect(second.kind).toBe('built');
      if (second.kind === 'built') expect(second.warnings.length).toBe(2);
    });
  });

  describe('the JSX shim: inject, not banner', () => {
    it("wires the shim in through esbuild's `inject` option and never passes `banner`", async () => {
      const packDir = await makeTempDir();
      const pack = packFor(packDir);
      const cacheDir = await makeTempDir();

      let capturedOptions: Record<string, unknown> | undefined;
      const build: NonNullable<PackBuildOptions['build']> = async (options) => {
        capturedOptions = options as Record<string, unknown>;
        const { build: inner } = fakeBuild();
        return inner(options);
      };

      const outcome = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]: 'export function Stat(){}',
        }),
      });

      expect(outcome.kind).toBe('built');
      expect(capturedOptions?.banner).toBeUndefined();
      expect(capturedOptions?.inject).toEqual([
        path.join(packDir, '__markii-jsx-shim.js'),
      ]);
    });

    it('rejects a pack whose own folder already has a file named like the internal JSX shim', async () => {
      const packDir = await makeTempDir();
      await writeFile(
        path.join(packDir, 'Stat.tsx'),
        'export function Stat(){}',
        'utf8',
      );
      await writeFile(
        path.join(packDir, '__markii-jsx-shim.js'),
        '// not the shim',
        'utf8',
      );
      const pack = packFor(packDir);
      const cacheDir = await makeTempDir();
      const { build } = fakeBuild();

      const outcome = await buildPackRegistrationScript(pack, cacheDir, {
        build,
        readComponentSource: readerFor({
          [pack.componentPaths.stat!]: 'export function Stat(){}',
        }),
      });

      expect(outcome.kind).toBe('failed');
      if (outcome.kind === 'failed') {
        expect(outcome.reason).toContain('reserved');
        expect(outcome.reason).toContain('__markii-jsx-shim.js');
      }
    });
  });
});
