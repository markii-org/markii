/**
 * One bundle: `dist/main.js`. Obsidian expects a plugin's entry to be
 * named exactly `main.js` sitting directly in its plugin folder alongside
 * `manifest.json` and `styles.css` — but that plugin folder is the
 * *installed* location inside a vault (`<vault>/.obsidian/plugins/markii/`),
 * not this workspace directory itself. Building to `dist/` (rather than
 * dropping `main.js` at the workspace root) keeps the generated bundle
 * covered by the repo's existing `dist/` ignore/lint-exclusion patterns,
 * the same way every other workspace's build output already is; the
 * manual-install steps (see the task report) copy `manifest.json`,
 * `styles.css`, and `dist/main.js` (already named `main.js`) into that
 * plugin folder. Format `cjs`
 * (Obsidian loads a plugin's `main.js` the same way VS Code loads an
 * extension's `main`, via `require`), platform `browser` (the plugin runs
 * inside Obsidian's renderer process, not a plain Node host), with
 * `obsidian` and Electron/Node builtins marked external — Obsidian injects
 * `obsidian` itself at runtime, and Electron's own built-ins are never
 * something a plugin bundle should inline.
 *
 * `@markii/*` resolves to each package's `src/`, exactly like
 * `scripts/workspace-aliases.config.ts` does for Vite/Vitest, and exactly
 * like `apps/vscode/esbuild.config.mjs` does for its own bundles: the
 * published `exports` maps point at `dist/`, which this repo's
 * `npm run build` (a `tsc --noEmit` typecheck per workspace) deliberately
 * does not produce. That map cannot be imported from here — it is
 * TypeScript and this file is plain ESM run by node — so the roots are
 * repeated below; keep this in sync with `scripts/workspace-aliases.config.ts`
 * if a package this plugin uses changes location.
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Package name -> that package's `src` directory (see the note above). */
const markiiSrcRoots = {
  '@markii/core': path.join(repoRoot, 'packages', 'markii-core', 'src'),
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
const buildOptions = {
  bundle: true,
  logLevel: 'info',
  minify: production,
  sourcemap: production ? false : 'inline',
  alias: markiiSrcRoots,
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(here, 'dist', 'main.js'),
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  jsx: 'automatic',
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    'node:*',
    'fs',
    'path',
    'os',
    'crypto',
  ],
};

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
} else {
  await build(buildOptions);
}
