/**
 * The one recipe for building the Web Worker isolate. Two builds share it:
 * the packaged `dist/browser-worker.js` (an ES module) and
 * `dist/browser-worker.classic.js` (an IIFE for a host that starts its
 * worker from a blob URL as a classic worker), and an app that embeds the
 * classic build into its own bundle calls it with its own alias map.
 *
 * `markiiSrcRoots(repoRoot)` resolves `@markii/*` to each package's `src/`,
 * so a worker never bundles a stale `dist/`.
 */
import path from 'node:path';

export function markiiSrcRoots(repoRoot) {
  return {
    '@markii/bundle': path.join(repoRoot, 'packages', 'markii-bundle', 'src'),
    '@markii/runtime': path.join(repoRoot, 'packages', 'markii-runtime', 'src'),
    '@markii/lua': path.join(repoRoot, 'packages', 'markii-lua', 'src'),
  };
}

/**
 * esbuild options for the browser worker, without `entryPoints` and
 * `outfile` (the caller sets them).
 *
 * `format: 'esm'` builds the module worker. `format: 'iife'` builds the
 * classic worker and adds a banner that shadows `process`, `Buffer` and
 * `require`: a host such as Obsidian creates its workers with Node
 * integration, and wasmoon's Emscripten bundle sniffs those globals to pick
 * a Node code path a blob worker cannot complete. With the banner the sniff
 * sees a plain worker scope. If the Node path is reached anyway, the
 * `require` guard fails with a sentence instead of doing real Node work.
 *
 * `alias` is merged over the `@markii/*` source roots, so a caller with a
 * larger map passes it whole.
 */
export function browserWorkerBuildOptions({ repoRoot, format, alias }) {
  return {
    bundle: true,
    platform: 'browser',
    format,
    target: 'es2022',
    alias: {
      ...markiiSrcRoots(repoRoot),
      ...alias,
      // micromark's browser build of this package calls
      // `document.createElement` at module top level, which throws inside a
      // Web Worker. The package's portable `index.js` is a plain
      // character-entities map.
      'decode-named-character-reference': path.join(
        repoRoot,
        'node_modules',
        'decode-named-character-reference',
        'index.js',
      ),
    },
    // wasmoon's Emscripten bundle carries a Node branch behind an
    // environment sniff. A browser worker never takes it; `url` and `module`
    // stay external so esbuild leaves that unreachable branch's imports
    // alone.
    external: ['url', 'module'],
    ...(format === 'iife'
      ? {
          banner: {
            js: "var process = undefined, Buffer = undefined; var require = (m) => { throw new Error('markii: the Lua runtime took its Node code path inside a Web Worker (tried to require ' + m + ')'); };",
          },
        }
      : {}),
  };
}
