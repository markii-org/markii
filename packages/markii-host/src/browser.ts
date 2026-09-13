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

// "Insert Component" (issue #17): the skeleton builder, the standard-set
// catalog, directive autocompletion, and fence auto-extension are ALL now
// `@markii/stdlib/editor` (GitHub issue #41): pure string/data logic over
// `@markii/stdlib` contracts, with zero dependencies and no environment of
// its own. Re-exported here so nothing importing them off `@markii/host` or
// `@markii/host/browser` has to change; a new consumer should import
// `@markii/stdlib/editor` directly instead.
export type { ComponentSkeleton, LineColumn } from '@markii/stdlib/editor';
export { componentSkeleton, offsetToLineColumn } from '@markii/stdlib/editor';
export type { InsertableComponent } from '@markii/stdlib/editor';
// Re-exported so a host reading `InsertableComponent.attributes` names the
// type through this seam rather than reaching past it into `@markii/pack`.
export type { PackComponentAttribute } from '@markii/pack';
export { LAYOUT_WRAPPER_NAMES } from '@markii/stdlib/editor';
// The PACK-AWARE catalog builder stays here: it needs `@markii/pack` to
// compose a pack's declared components onto `@markii/stdlib/editor`'s
// standard-set list. See `./insert/component-catalog.ts`.
export { buildComponentCatalog } from './insert/component-catalog.js';

// Directive autocompletion (issue #27, slice 1): pure line/column parsing
// over the insert catalog and `@markii/stdlib` contracts, plus hover
// documentation.
export type {
  CompletionContext,
  CompletionContextKind,
  CompletionItem,
  CompletionItemKind,
  ComponentDocumentation,
  HoverInfo,
} from '@markii/stdlib/editor';
export {
  completionAt,
  componentDocumentation,
  formatComponentDocumentation,
  hoverAt,
} from '@markii/stdlib/editor';

// Fence auto-extension on insert: the pure scan that finds the container
// fence pairs enclosing an insertion point, and the minimal set of fence
// lines to lengthen so a newly inserted container still nests legally, plus
// the predicate (issue #57) that tells a completion trigger a bare colon
// run CLOSES an open container rather than opening a new one. Both hosts
// apply the fence edits in ONE undoable edit together with the insertion.
export type {
  EnclosingContainerFence,
  FenceLineEdit,
} from '@markii/stdlib/editor';
export {
  closesOpenContainerFence,
  enclosingContainerFences,
  fenceExtensionEdits,
  insertedContainerColonCount,
} from '@markii/stdlib/editor';

// Pack CSS lint rules: plain string analysis, no filesystem of its own (a
// caller hands it the stylesheet text).
export {
  lintPackCss,
  lintPackCssColors,
  lintPackCssPrefix,
} from './packs/pack-css-lint.js';

// Failure wording shared with the hosts' diagnostics surfaces.
export type { ValuesFailure } from './values-failure.js';

// GitHub issue #35: folding one arriving value into a preview's store. Pure
// data work over `@markii/runtime` types, and the VS Code webview (a browser
// bundle) is one of its two callers.
export { mergeArrivingValue } from './values-merge.js';

// Render-time diagnostics: one event from either renderer's `onDiagnostic`
// option becomes the one line both hosts write to their diagnostics
// surface.
export {
  createRenderDiagnosticCollector,
  createRenderDiagnosticReporter,
  renderDiagnosticLine,
} from './diagnostics/render-diagnostics.js';

// Batch 11: the HostAdapter contract's TYPES (erased before a bundler ever
// sees them) plus the pure, Node-free behavior modules — `./host/labels.ts`,
// `./host/script-execution.ts`, and `./host/refresh-interval.ts` import
// nothing but `@markii/runtime`'s `RunTrigger` type and each other, so they
// are reachable from here per `tmp/W11-adapter-design.md` section 1's rule.
// `./host/create-host.ts` and `./host/run-behavior.ts` are NOT re-exported
// here: they reach the isolate and the filesystem, and stay main-entry only.
export type {
  HostAdapter,
  HostDirEntry,
  HostEditor,
  HostExportCapabilities,
  HostExportFormat,
  HostIsolate,
  HostLabels,
  HostPackSource,
  HostPromptRequest,
  HostTextEdit,
} from './host/adapter.js';
export { BROWSER_ISOLATE_ENTRY } from './host/adapter.js';
export { CLI_LABELS, OBSIDIAN_LABELS, VSCODE_LABELS } from './host/labels.js';
export {
  scheduledRefreshNotStartedLine,
  scriptsDisabledConfirmationText,
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNotice,
  scriptsDisabledNoticeText,
  scriptsEnabledConfirmationText,
} from './host/script-execution.js';
export {
  MIN_REFRESH_INTERVAL_SECONDS,
  parseRefreshIntervalSeconds,
  refreshIntervalMsFromSeconds,
  refreshIntervalValidationMessage,
} from './host/refresh-interval.js';

// Batch 11 Phase 1b: `./host/editor-behavior.ts` is required to be
// Node-free (`tmp/BRIEF-11-host.md`'s Phase 1b instructions) — it imports
// only `@markii/stdlib/editor`'s pure completion/hover/skeleton math — so
// it is reachable from here exactly like the Phase 1a modules above.
// `./host/pack-install.ts`, `./host/pack-archive.ts`, `./host/pack-load.ts`,
// and `./host/export-behavior.ts` all reach `node:*` (directly, or via
// `../export/note-export.js`'s `@markii/html` dependency) or the
// filesystem-based pack discovery in `../packs/discover.ts`, so they stay
// main-entry only.
export type {
  CatalogCache,
  InsertComponentEdit,
  InsertComponentPlan,
} from './host/editor-behavior.js';
export {
  LAYOUT_ORIGIN_TAG,
  STANDARD_ORIGIN_TAG,
  completeAtViaEditor,
  completionOriginTag,
  createCatalogCache,
  hoverAtViaEditor,
  hoverDocumentationText,
  insertComponentPlan,
} from './host/editor-behavior.js';
