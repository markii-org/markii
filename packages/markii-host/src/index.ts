// @markii/host: the shared, host-neutral script-running layer for Markii
// hosts (`apps/vscode`, and any future host such as an Obsidian plugin).
// Plain Node — no `vscode`, no React — so it stays reusable and
// unit-testable across hosts. Private workspace package: never published,
// never added to `build:dist`. See AGENTS.md's repo-layout entry for
// `packages/markii-host` for the module-by-module breakdown.
//
// This is the security-critical layer (tier gating, the grant model,
// DNS/address pinning, the terminatable-isolate watchdog) — a second,
// drifting copy of any of this is the one outcome to avoid, which is why
// it lives here instead of inside `apps/vscode`.

export type { ValuesFailure } from './values-failure.js';

export type {
  RunJob,
  RunResult,
  RunFailure,
  SpawnRunOptions,
} from './run/run-host.js';
export {
  defaultWorkerPath,
  spawnRun,
  workerThreadIsolate,
} from './run/run-host.js';
export type {
  IsolateSpawner,
  RunIsolate,
  SpawnIsolateOptions,
} from './run/isolate.js';
export { createBrowserIsolate } from './run/browser-isolate.js';
export type {
  BrowserIsolateOptions,
  WorkerLike,
} from './run/browser-isolate.js';
export { createNetProvider } from './run/net-provider.js';
export { isNetBridgeRequest, serveNetRequest } from './run/net-bridge.js';
export type { NetBridgeReply, NetBridgeRequest } from './run/net-bridge.js';

export type {
  CacheSnapshot,
  RunOnceOptions,
  RunOnceResult,
} from './run/run-flow.js';
export {
  MAX_CACHE_SNAPSHOT_BYTES,
  MAX_VALUES_SNAPSHOT_BYTES,
  cacheStorageKeyFor,
  isCacheSnapshotShape,
  mergePersistedValues,
  readPersistedValues,
  runOnce,
  serializeCacheSnapshotIfSmallEnough,
  valuesStorageKeyFor,
} from './run/run-flow.js';

export type {
  GrantFlowOptions,
  GrantFlowRequirements,
  GrantFlowResult,
  GrantMemento,
  PromptBundleAccess,
  PromptHost,
  PromptManyHosts,
  PromptUnknownHosts,
  Thenable,
} from './run/grant-flow.js';
export {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  MAX_HOST_PROMPTS,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  bundleAccessPromptMessage,
  clearGrantForDocument,
  hostPromptMessage,
  isSafeHostForPrompt,
  manyHostsPromptMessage,
  resolveStoredGrant,
  runGrantFlow,
} from './run/grant-flow.js';

export type {
  BuildBundleSnapshotOptions,
  BundleSnapshotResult,
  EncodedBundleCache,
} from './run/bundle-run.js';
export {
  DEFAULT_MAX_BUNDLE_SNAPSHOT_BYTES,
  DEFAULT_MAX_BUNDLE_SNAPSHOT_FILE_BYTES,
  MAX_PERSISTED_BUNDLE_CACHE_BYTES,
  buildBundleSnapshot,
  bundleModulesFromSnapshot,
  cacheFilesFrom,
  decodeBundleCacheFromStorage,
  encodeBundleCacheForStorage,
  manifestBundleFsGrants,
  manifestNetHosts,
  withPersistedCache,
} from './run/bundle-run.js';

export type { RunTrace } from './run/run-trace.js';
export {
  isRunTrace,
  lastRunStorageKeyFor,
  readLastRunTrace,
  writeLastRunTrace,
} from './run/run-trace.js';

export type { RunRequirements } from './run/script-requirements.js';
export { extractRunRequirements } from './run/script-requirements.js';

export type { SnapshotStorage } from './run/snapshot-storage.js';
export { createSnapshotStorage } from './run/snapshot-storage.js';

export { staleValuesForRehydration } from './run/stale-values.js';

// Static export (issue #28): one note's text plus its last-run values ->
// a self-contained HTML document, via `@markii/html`. Host-neutral: both
// apps build the same file and name it the same way.
export type {
  ComposeNoteHtmlExportOptions,
  ExportBodyRenderer,
  ExportBodyResult,
  ExportExtension,
  ExportPackStylesheet,
  ExportRenderInfo,
  NoteExportBuildRequest,
  NoteExportDocument,
  NoteHtmlExportOptions,
  StaticExportReason,
} from './export/note-export.js';
export {
  EXPORT_PAGE_CSS,
  FALLBACK_EXPORT_BASE_NAME,
  MARK_EXTENSION,
  buildNoteExport,
  buildNoteHtmlExport,
  composeNoteHtmlExport,
  noteHasScripts,
  exportBaseName,
  exportDocumentTitle,
  exportedFileName,
  exportedSiblingPath,
  packStylesheetsCss,
} from './export/note-export.js';

// Image embedding (issue #28 slice 3, part 1): a note's local images become
// `data:` URIs so an exported file stands on its own. The reading is a host
// seam; the cap, the MIME rules, and the reporting live here.
export type {
  EmbeddedImageReport,
  ExportImageReader,
  ExportImageResult,
  ImageSkipReason,
  SkippedImage,
} from './export/image-embed.js';
export {
  EMBEDDABLE_IMAGE_EXTENSIONS,
  EMPTY_IMAGE_REPORT,
  MAX_EMBEDDED_IMAGE_BYTES,
  embedImagesInHtml,
  encodeBase64,
  isEmbeddableImageSrc,
  mimeTypeForImageSrc,
  toImageDataUri,
} from './export/image-embed.js';

// Cascade export (issue #28 slice 3, part 2): walking a note's links,
// naming each exported file, and rewriting the links between them. Pure
// and host-neutral, so a second host can adopt the command later.
export type { NoteLink, NoteLinkTargetResolver } from './export/note-links.js';
export {
  extractNoteLinks,
  isLocalNoteTarget,
  maskCodeRegions,
  rewriteNoteLinks,
} from './export/note-links.js';
export type {
  CascadeLinkResolver,
  CascadeNote,
  CascadeNoteReader,
  CascadeTruncation,
  CascadeWalkOptions,
  CascadeWalkResult,
} from './export/cascade.js';
export {
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  rewriteCascadeLinks,
  walkNoteCascade,
} from './export/cascade.js';
export type { ExportArchiveEntry } from './export/export-zip.js';
export { zipExportArchive } from './export/export-zip.js';

export type {
  HostLookup,
  PinnedAddress,
  PinPolicy,
  PinResult,
  ResolvedAddress,
} from './run/net-pinning.js';
export { pinHostAddress, pinnedLookup } from './run/net-pinning.js';

export type { AddressScope } from './run/ip-address.js';
export {
  classifyIpAddress,
  describeScope,
  isRestrictedScope,
} from './run/ip-address.js';

export type { PackModulesMap } from './run/lua-resolver.js';
export { createPackModuleResolver } from './run/lua-resolver.js';

export type {
  PackBuildOptions,
  PackBuildOutcome,
  PackBuildSource,
  PackFileReader,
} from './packs/pack-build.js';
export {
  buildPackRegistrationScript,
  computeCacheKey,
} from './packs/pack-build.js';

export {
  lintPackCss,
  lintPackCssColors,
  lintPackCssPrefix,
} from './packs/pack-css-lint.js';

// Pack discovery/loading plumbing shared by every host (docs/packs.md;
// hoisted out of apps/vscode's and apps/obsidian's duplicate copies).
// `PackFileReader` from `./packs/discover.js` is intentionally NOT
// re-exported here: it would collide with `./packs/pack-build.js`'s own
// `PackFileReader` (a deliberately separate, structurally identical type —
// see that file's doc comment). Nothing outside this package needs to name
// discover's variant directly; `discoverPacks`'s default parameter covers
// every production caller, and its own test imports the type via a
// relative path within this package.
export type {
  DiscoveredPack,
  DiscoverPacksResult,
  PackDirectoryLister,
  SkippedPackFolder,
} from './packs/discover.js';
export {
  createNodeDirectoryLister,
  createNodeFileReader,
  discoverPacks,
  installedNamespaces,
} from './packs/discover.js';

export type { PackScriptsReader } from './packs/pack-scripts.js';
export {
  createNodeReader as createNodePackScriptsReader,
  loadPackModules,
} from './packs/pack-scripts.js';

export { relativePackEntries, resolvePackPaths } from './packs/pack-paths.js';

export type {
  PackDiagnosticsContext,
  PackDiagnosticsPack,
  PackDiagnosticsSkippedFolder,
} from './packs/pack-diagnostics.js';
export {
  formatPackDiagnosticLines,
  skippedPackCount,
} from './packs/pack-diagnostics.js';

// Prebuilt-pack convention (issue #15): the sibling webview.js/webview.css
// distribution shape, and the shadowing detection docs/packs.md describes.
export type {
  PackPathExists,
  PrebuiltPackResolution,
} from './packs/prebuilt.js';
export {
  PREBUILT_SCRIPT_FILENAME,
  PREBUILT_STYLESHEET_FILENAME,
  prebuiltScriptPathFor,
  prebuiltStylesheetPathFor,
  resolvePrebuiltPack,
} from './packs/prebuilt.js';

// "Export pack" (issue #16): compiles a pack and writes a clean,
// distributable folder at a caller-chosen destination — never inside the
// pack's own source folder. Supersedes issue #15's in-pack-folder
// "build for distribution" behavior, which this replaces entirely.
export type {
  ConfirmPackOverwrite,
  ExportPackOptions,
  PackExportBuilder,
  PackExportFs,
  PackExportOutcome,
} from './packs/pack-export.js';
export { exportPack, resolveExportTarget } from './packs/pack-export.js';

export type {
  BuildRenderRegistryResult,
  QueuedPackRegistration,
} from './packs/pack-render-registry.js';
export { buildRenderRegistry } from './packs/pack-render-registry.js';

// "Insert Component" (issue #17, slice 1): the shared skeleton-building and
// catalog logic both hosts' insert commands use — pure, host-neutral, no
// `vscode`/`obsidian`. See `./insert/component-skeleton.ts` and
// `./insert/component-catalog.ts`.
export type {
  ComponentSkeleton,
  LineColumn,
} from './insert/component-skeleton.js';
export {
  componentSkeleton,
  offsetToLineColumn,
} from './insert/component-skeleton.js';
export type { InsertableComponent } from './insert/component-catalog.js';
// Re-exported so a host reading `InsertableComponent.attributes` names the
// type through this seam rather than reaching past it into `@markii/pack`.
export type { PackComponentAttribute } from '@markii/pack';
export { buildComponentCatalog } from './insert/component-catalog.js';

// Directive autocompletion (issue #27, slice 1): pure line/column parsing
// over the insert catalog and `@markii/stdlib` contracts, plus hover
// documentation. See `./complete/index.ts`.
export type {
  CompletionContext,
  CompletionContextKind,
  CompletionItem,
  CompletionItemKind,
  ComponentDocumentation,
  HoverInfo,
} from './complete/index.js';
export {
  completionAt,
  componentDocumentation,
  formatComponentDocumentation,
  hoverAt,
} from './complete/index.js';

// Fence auto-extension on insert: the pure scan that finds the container
// fence pairs enclosing an insertion point, and the minimal set of fence
// lines to lengthen so a newly inserted container still nests legally.
// Both hosts apply the returned edits in ONE undoable edit together with
// the insertion. See `./fences/container-fences.ts`.
export type {
  EnclosingContainerFence,
  FenceLineEdit,
} from './fences/container-fences.js';
export {
  enclosingContainerFences,
  fenceExtensionEdits,
  insertedContainerColonCount,
} from './fences/container-fences.js';
