/**
 * Executed probe of the `@markii/host` entries a browser bundle imports
 * (`.`, `./internal` and `./browser`): proves each is environment-neutral by
 * bundling it for a browser, not by grepping its source for `node:` strings.
 *
 * The main entry is the one a browser bundle imports, the VS Code webview
 * among them (a `platform: 'browser'` / `format: 'iife'` build with no
 * `external` entries, because the webview's CSP forbids a module graph
 * fetched at runtime). Everything that needs Node lives behind
 * `@markii/host/node` (`src/node.ts`).
 *
 * Three assertions per entry:
 * - it bundles at `platform: 'browser'` with no `node:` specifier surviving;
 * - the bundle's input list never reaches `src/node.ts` or the modules
 *   only it pulls in (the Node file system seams, the worker-thread
 *   isolate, the static HTML engine, `esbuild-wasm`, `@markii/html`), and
 *   carries no `@markii/react` runtime code;
 * - a negative control proves the check can fail.
 *
 * A source-text grep would miss a transitive import three modules deep;
 * only a real bundler resolving the real module graph catches that. If this
 * test fails, cut the offending import from the entry's graph; do not
 * loosen the test.
 */
import { build } from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// Mirrors `esbuild.config.mjs`'s `markiiSrcRoots`: the webview build
// resolves every `@markii/*` bare specifier to that package's `src/`
// (the published `exports` maps point at `dist/`, which the dev build
// does not produce). `browser.ts`
// only reaches `@markii/pack`, `@markii/react`, `@markii/runtime`, and
// `@markii/stdlib` transitively, but the full map is repeated here so this
// probe resolves `@markii/*` exactly the way the real webview build does,
// not a hand-picked subset of it.
const markiiSrcRoots = {
  '@markii/core': path.join(repoRoot, 'packages', 'markii-core', 'src'),
  '@markii/bundle': path.join(repoRoot, 'packages', 'markii-bundle', 'src'),
  '@markii/stdlib': path.join(repoRoot, 'packages', 'markii-stdlib', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
  '@markii/pack': path.join(repoRoot, 'packages', 'markii-pack', 'src'),
  '@markii/react': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-react',
    'src',
  ),
  '@markii/host': path.join(repoRoot, 'packages', 'markii-host', 'src'),
};

describe.each(['index.ts', 'internal.ts'])(
  '@markii/host %s is environment-neutral under the webview bundle config',
  (entryFile) => {
    it('bundles cleanly at platform: browser with no node: specifier surviving', async () => {
      const entryPoint = path.join(
        repoRoot,
        'packages',
        'markii-host',
        'src',
        entryFile,
      );

      const result = await build({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        target: 'chrome122',
        alias: markiiSrcRoots,
        logLevel: 'silent',
        metafile: true,
      });

      expect(result.outputFiles).toHaveLength(1);
      const bundled = result.outputFiles[0]?.text ?? '';
      expect(bundled.length).toBeGreaterThan(0);

      // Belt-and-suspenders: even if esbuild's browser-platform resolver
      // ever stopped throwing on an unresolved `node:*` import, a bare
      // `node:` specifier surviving into the emitted bundle text would
      // still mean this entry is not actually Node-free. Fail loudly on
      // that directly rather than relying only on the build not throwing.
      expect(bundled).not.toMatch(/\bnode:[a-z_]+/);

      // The Node entry and everything only it reaches stays out of the graph.
      const inputs = Object.keys(result.metafile.inputs).map((p) =>
        p.split(path.sep).join('/'),
      );
      const forbidden = [
        /markii-host\/src\/node\.ts$/,
        /markii-host\/src\/node-fs\.ts$/,
        /markii-host\/src\/html-engine\.ts$/,
        /markii-host\/src\/run\/node-isolate\.ts$/,
        /markii-host\/src\/run\/net-provider\.ts$/,
        /markii-host\/src\/packs\/pack-build\.ts$/,
        /markii-host\/src\/host\/conformance-runner\.ts$/,
        /markii-html\/src\//,
        /esbuild-wasm/,
      ];
      for (const pattern of forbidden) {
        expect(
          inputs.filter((input) => pattern.test(input)),
          String(pattern),
        ).toEqual([]);
      }
      // `@markii/react` may appear as erased types only: no runtime module.
      expect(
        inputs.filter((input) => /markii-react\/src\//.test(input)),
      ).toEqual([]);
    }, 30_000);

    it('negative control: the same browser-platform build genuinely rejects a node: import', async () => {
      // Proves the probe above can actually detect leakage. Without this,
      // a probe that silently stopped checking anything (a config typo,
      // an esbuild version that started tolerating node: imports) would
      // still pass. This deliberately-bad in-memory entry imports from
      // `node:fs` under the exact same browser-platform settings used
      // above and must fail to build.
      const build_ = build({
        stdin: {
          contents: `import { readFileSync } from 'node:fs';\nexport { readFileSync };`,
          loader: 'ts',
          resolveDir: repoRoot,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        target: 'chrome122',
        alias: markiiSrcRoots,
        logLevel: 'silent',
      });

      await expect(build_).rejects.toThrow();
    }, 30_000);
  },
);

describe('@markii/host/browser platform entry is environment-neutral', () => {
  it('bundles at platform: browser with no node: specifier and none of the Node-only modules', async () => {
    const entryPoint = path.join(
      repoRoot,
      'packages',
      'markii-host',
      'src',
      'browser.ts',
    );

    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      target: 'chrome122',
      alias: markiiSrcRoots,
      logLevel: 'silent',
      metafile: true,
    });

    const bundled = result.outputFiles[0]?.text ?? '';
    expect(bundled.length).toBeGreaterThan(0);
    expect(bundled).not.toMatch(/\bnode:[a-z_]+/);

    const inputs = Object.keys(result.metafile.inputs).map((p) =>
      p.split(path.sep).join('/'),
    );
    const forbidden = [
      /markii-host\/src\/node\.ts$/,
      /markii-host\/src\/node-fs\.ts$/,
      /markii-host\/src\/html-engine\.ts$/,
      /markii-host\/src\/run\/node-isolate\.ts$/,
      /markii-host\/src\/run\/net-provider\.ts$/,
      /markii-host\/src\/run\/net-pinning\.ts$/,
      /markii-host\/src\/host\/conformance-runner\.ts$/,
      /markii-html\/src\//,
      /markii-react\/src\//,
      /esbuild-wasm/,
      // The Lua engine lives in the worker bundle, never in the page.
      /markii-lua\/src\//,
      /wasmoon/,
    ];
    for (const pattern of forbidden) {
      expect(
        inputs.filter((input) => pattern.test(input)),
        String(pattern),
      ).toEqual([]);
    }
  }, 30_000);
});
