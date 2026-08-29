/**
 * Executed probe of `@markii/host/browser` (issue #20): proves it is
 * actually Node-free by bundling it, not by grepping its source for
 * `node:` strings.
 *
 * WHY THIS TEST EXISTS. `@markii/host`'s `.` entry (`src/index.ts`) is one
 * barrel over the whole package, and most of that package is Node: the Run
 * path reaches `node:worker_threads`, pack discovery reaches `node:fs`,
 * pinning reaches `node:dns`. This extension's webview bundle
 * (`esbuild.config.mjs`'s `webviewBuild`) is `platform: 'browser'` /
 * `format: 'iife'` with NO `external` entries at all, because the
 * webview's CSP forbids a module graph fetched at runtime — every import
 * has to actually resolve at bundle time. Before `@markii/host/browser`
 * existed, the webview could not import even a pure function from
 * `@markii/host`, so pack-registration validation and merging were
 * hand-duplicated in the webview instead, and that duplicated logic
 * drifted from the real thing (issue #19's duplicate-composed-name guard
 * had to be fixed in two places). `packages/markii-host/src/browser.ts`
 * is the fix: a second, environment-free entry point re-exporting only the
 * modules that never touch Node. Its own top comment states the rule —
 * nothing reachable from it may import `node:*`, even transitively, even
 * behind a lazy import — and names this file as what makes that rule
 * executable instead of a comment someone can silently violate.
 *
 * A source-text grep for `node:` would miss the actual failure mode: a
 * transitive import three modules deep that never appears in
 * `browser.ts` itself. Only a real bundler resolving the real module graph
 * catches that, so this test hands `browser.ts` to esbuild with the same
 * `platform: 'browser'` / `format: 'iife'` / alias settings the webview
 * build uses (mirrored from `esbuild.config.mjs`'s `shared`/`webviewBuild`
 * below, since that file is a driver script with a top-level build call —
 * importing it here would trigger a real build as a side effect of loading
 * a test) and asserts the bundle succeeds.
 *
 * If this test ever fails, it means something newly reachable from
 * `@markii/host/browser` pulled in a Node builtin: either a new export was
 * added to `browser.ts` that shouldn't have been, or an existing exported
 * module gained a new dependency that isn't actually environment-free. The
 * fix is to cut that import, not to loosen this test.
 */
import { build } from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// Mirrors `esbuild.config.mjs`'s `markiiSrcRoots`: the webview build
// resolves every `@markii/*` bare specifier to that package's `src/`
// (the published `exports` maps point at `dist/`, which this repo's build
// deliberately doesn't produce — see that file's top comment). `browser.ts`
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

describe('@markii/host/browser is Node-free under the webview bundle config', () => {
  it('bundles cleanly at platform: browser with no node: specifier surviving', async () => {
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
      format: 'iife',
      target: 'chrome122',
      alias: markiiSrcRoots,
      logLevel: 'silent',
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
});
