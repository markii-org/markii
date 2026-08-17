/**
 * Two bundles, one build script:
 *
 *   1. `dist/extension.js`   — the extension host entry. Platform `node`,
 *      format `cjs` (VS Code loads `main` with `require`), with `vscode`
 *      marked external because the editor injects that module at runtime.
 *   2. `dist/webview/main.js` + `dist/webview/main.css` — the preview
 *      webview. Platform `browser`, format `iife` (a single classic script
 *      the CSP can carry one nonce for; no module graph is fetched at
 *      runtime, which is what keeps `script-src` nonce-only). React,
 *      react-dom, `@markii/*` and `doc.css` are all bundled in.
 *
 * `@markii/*` resolves to each package's `src/`, exactly like
 * `scripts/workspace-aliases.config.ts` does for Vite/Vitest: the published
 * `exports` maps point at `dist/`, which the repo's `npm run build` (a
 * `tsc --noEmit` typecheck per workspace) deliberately does not produce.
 * That map cannot be imported from here — it is TypeScript and this file is
 * plain ESM run by node — so the roots are repeated below; keep the two in
 * sync when a package is added.
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Package name -> that package's `src` directory (see the note above). */
const markiiSrcRoots = {
  '@markii/core': path.join(repoRoot, 'packages', 'markii-core', 'src'),
  '@markii/stdlib': path.join(repoRoot, 'packages', 'markii-stdlib', 'src'),
  '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
  '@markii/react': path.join(
    repoRoot,
    'packages',
    'platforms',
    'markii-react',
    'src',
  ),
};

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  logLevel: 'info',
  minify: production,
  sourcemap: production ? false : 'inline',
  alias: markiiSrcRoots,
};

/** @type {import('esbuild').BuildOptions} */
const extensionBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'extension.ts')],
  outfile: path.join(here, 'dist', 'extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuild = {
  ...shared,
  entryPoints: [path.join(here, 'src', 'webview', 'main.tsx')],
  outfile: path.join(here, 'dist', 'webview', 'main.js'),
  platform: 'browser',
  format: 'iife',
  // VS Code 1.90 ships Electron 29 / Chromium 122; `color-mix()` and
  // `:has()` (used by the theme sheet and `doc.css`) are available there.
  target: 'chrome122',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

if (watch) {
  const contexts = await Promise.all([
    context(extensionBuild),
    context(webviewBuild),
  ]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([build(extensionBuild), build(webviewBuild)]);
}
