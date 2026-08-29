// @markii/host/browser: the environment-free half of this package (issue
// #20), importable as VALUES from a browser bundle.
//
// WHY THIS FILE EXISTS. `./index.ts` is one barrel over the whole package,
// and most of that package is Node: the Run path reaches `node:worker_threads`,
// pack discovery reaches `node:fs`, pinning reaches `node:dns`. A bundler
// following the barrel therefore has to resolve every one of those, so a
// browser bundle could not import even a pure function from here. VS Code's
// webview bundle is exactly that case: `apps/vscode/esbuild.config.mjs`'s
// `webviewBuild` is `platform: 'browser'`/`format: 'iife'` with NO `external`
// entries, because the webview's CSP forbids a module graph fetched at
// runtime. It had to hand-duplicate this package's pack-registration
// validation and merging as a result, and duplicated logic drifts.
//
// The polarity is the mirror image of `@markii/bundle`'s, which is
// browser-safe at `.` with Node behind `./fs`. Here `.` stays the Node
// entry, because every existing consumer of this package is Node (both
// apps' extension-host and plugin code) and issue #20 is hygiene, not a
// migration: nothing already importing `@markii/host` has to change.
//
// THE RULE FOR THIS FILE: every module reachable from here must import only
// other `@markii/*` packages or environment-free siblings. No `node:*`, not
// even transitively, and not even behind a lazy import. A type-only import
// of a Node-side module is fine (TypeScript erases it before a bundler ever
// sees it), which is how `./insert/component-catalog.ts` can name
// `DiscoveredPack` without pulling `./packs/discover.ts` into a browser
// bundle. `apps/vscode/src/browser-entry.probe.test.ts` bundles this entry
// with esbuild at `platform: 'browser'` and fails on any `node:` leakage, so
// this rule is executable rather than a comment.

// The pack registration convention's shared half: structural validation of
// what a pack script queued, plus the merge that builds a render registry
// from it — including the keep-first duplicate-composed-name guard from
// issue #19. Both hosts now run the SAME merge, so the guard can no longer
// be present on one host's path and absent on the other's.
export type {
  BuildRenderRegistryResult,
  DuplicateComposedName,
  QueuedPackRegistration,
} from './packs/pack-render-registry.js';
export { buildRenderRegistry } from './packs/pack-render-registry.js';

// "Insert Component" (issue #17): the catalog and the skeleton builder are
// pure string/data logic over `@markii/stdlib` contracts and `@markii/pack`
// manifests, with no environment of their own.
export type {
  ComponentSkeleton,
  LineColumn,
} from './insert/component-skeleton.js';
export {
  componentSkeleton,
  offsetToLineColumn,
} from './insert/component-skeleton.js';
export type { InsertableComponent } from './insert/component-catalog.js';
export {
  LAYOUT_WRAPPER_NAMES,
  buildComponentCatalog,
} from './insert/component-catalog.js';

// Pack CSS lint rules: plain string analysis, no filesystem of its own (a
// caller hands it the stylesheet text).
export {
  lintPackCss,
  lintPackCssColors,
  lintPackCssPrefix,
} from './packs/pack-css-lint.js';

// Failure wording shared with the hosts' diagnostics surfaces.
export type { ValuesFailure } from './values-failure.js';
