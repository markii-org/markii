import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pkgSrc(...segments: string[]): string {
  return path.join(repoRoot, ...segments, 'src');
}

/**
 * Shared Vite/Vitest `resolve.alias` entries redirecting every `@markii/*`
 * import to that package's `src/` DIRECTORY (not `src/index.ts`) instead of
 * its built `dist/`.
 *
 * This is what keeps `npm test`, `npm run dev`, and the playground's build
 * resolving `@markii/*` to SOURCE with no prebuild step, even though each
 * package's published `package.json#exports` points `.`/`import`/`types` at
 * `dist` for real npm consumers (see each package's `tsconfig.build.json`
 * and `package.json`). Consulted by every package's `vitest.config.ts` and
 * by `apps/playground/vite.config.ts`.
 *
 * Vite resolves a string `find` by matching the imported specifier exactly,
 * OR by matching `find + '/'` as a prefix (this is `@rollup/plugin-alias`'s
 * matching rule, which Vite's `resolve.alias` uses). Aliasing to the
 * package's `src` directory — rather than directly to `src/index.ts` — lets
 * ONE entry per package cover every subpath export too, via Vite's
 * directory-index resolution fallback:
 *   `@markii/core`            -> `<core>/src`            -> `src/index.ts`
 *   `@markii/core/corpus`     -> `<core>/src/corpus`      -> `src/corpus.ts`
 *   `@markii/bundle/fs`       -> `<bundle>/src/fs`        -> `src/fs.ts`
 *   `@markii/react/components` -> `<react>/src/components` -> `src/components/index.ts`
 *   `@markii/react/doc.css`   -> `<react>/src/doc.css`    (exact file)
 * — matching each package's `exports` map subpaths without listing them
 * separately here.
 */
export const workspaceAliases = [
  { find: '@markii/core', replacement: pkgSrc('packages', 'markii-core') },
  {
    find: '@markii/stdlib',
    replacement: pkgSrc('packages', 'markii-stdlib'),
  },
  {
    find: '@markii/runtime',
    replacement: pkgSrc('packages', 'markii-runtime'),
  },
  {
    find: '@markii/bundle',
    replacement: pkgSrc('packages', 'markii-bundle'),
  },
  {
    find: '@markii/pack',
    replacement: pkgSrc('packages', 'markii-pack'),
  },
  { find: '@markii/lua', replacement: pkgSrc('packages', 'markii-lua') },
  {
    find: '@markii/react',
    replacement: pkgSrc('packages', 'platforms', 'markii-react'),
  },
  {
    find: '@markii/html',
    replacement: pkgSrc('packages', 'platforms', 'markii-html'),
  },
];
