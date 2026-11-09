// @markii/host: the shared, host-neutral script-running layer for Markii
// hosts (`apps/vscode`, and any future host such as an Obsidian plugin).
// Environment-neutral: nothing reachable from this entry imports `node:*`,
// `esbuild-wasm`, `@markii/react` or `@markii/html` at runtime
// (`apps/vscode/src/browser-entry.probe.test.ts` bundles it for a browser to
// prove it). What needs Node lives in `./node.ts`, published as
// `@markii/host/node`. Private workspace package: never published,
// never added to `build:dist`. See AGENTS.md's repo-layout entry for
// `packages/markii-host` for the module-by-module breakdown.
//
// This is the security-critical layer (tier gating, the grant model,
// DNS/address pinning, the terminatable-isolate watchdog) — a second,
// drifting copy of any of this is the one outcome to avoid, which is why
// it lives here instead of inside `apps/vscode`.

export type { ValuesFailure } from './values-failure.js';
export { mergeArrivingValue } from './values-merge.js';

export type {
  RunJob,
  RunResult,
  RunFailure,
  RunProgress,
  SpawnRunOptions,
  SpawnRunRequest,
} from './run/run-host.js';
export { isRunProgress } from './run/run-progress.js';
export { spawnRun } from './run/run-host.js';
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
  netDeclarationDiagnostics,
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
  HtmlExportEngine,
  CascadeIndexEntry,
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
  EXPORT_HIDE_SCRIPT_BLOCKS_CLASS,
  EXPORT_PAGE_CSS,
  FALLBACK_EXPORT_BASE_NAME,
  MARK_EXTENSION,
  buildCascadeIndexHtml,
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
  CASCADE_INDEX_FILE_NAME,
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  rewriteCascadeLinks,
  walkNoteCascade,
} from './export/cascade.js';
export type {
  CascadeArchiveRequest,
  CascadeArchiveResult,
  CascadeExportOutcome,
  CascadeExportedNote,
  UnreadableCascadeNote,
} from './host/cascade-export-behavior.js';
export {
  buildCascadeArchive,
  cascadeDiagnosticLines,
  cascadeReasonOf,
  cascadeResultMessage,
  countedNoun,
} from './host/cascade-export-behavior.js';
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

// Pack discovery/loading plumbing shared by every host (docs/packs.md;
// hoisted out of apps/vscode's and apps/obsidian's duplicate copies).
// `PackFileReader` from `./packs/discover.js` is intentionally not
// re-exported: `discoverPacks` takes it as a parameter and no caller outside
// this package needs to name it.
export type {
  DiscoveredPack,
  DiscoverPacksResult,
  EngineUnsupportedPack,
  PackDirectoryLister,
  SkippedPackFolder,
} from './packs/discover.js';
export {
  componentsWithoutEngineView,
  declaredPackComponents,
  discoverPacks,
  installedNamespaces,
} from './packs/discover.js';

export type { PackScriptsReader } from './packs/pack-scripts.js';
export { loadPackModules } from './packs/pack-scripts.js';

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
  PREBUILT_TERMINAL_SCRIPT_FILENAME,
  emptyWebviewScript,
  prebuiltScriptPathFor,
  prebuiltStylesheetPathFor,
  prebuiltTerminalScriptPathFor,
  resolvePrebuiltPack,
} from './packs/prebuilt.js';

export type {
  BuildRenderRegistryResult,
  DuplicateComposedName,
  PackRegistryEngine,
  QueuedPackRegistration,
} from './packs/pack-render-registry.js';
export { buildRenderRegistry } from './packs/pack-render-registry.js';

// "Insert Component" (issue #17, slice 1): the skeleton builder, the
// standard-set catalog, directive autocompletion, and fence auto-extension
// are ALL now `@markii/stdlib/editor` (GitHub issue #41) — pure,
// host-neutral, zero dependencies, no `vscode`/`obsidian`. Re-exported here
// so nothing importing them off `@markii/host` has to change; a new
// consumer should import `@markii/stdlib/editor` directly instead. The
// PACK-AWARE catalog builder stays in this package (see
// `./insert/component-catalog.ts`): it needs `@markii/pack` to compose a
// pack's declared components onto the standard-set list.
export type { ComponentSkeleton, LineColumn } from '@markii/stdlib/editor';
export { componentSkeleton, offsetToLineColumn } from '@markii/stdlib/editor';
export { LAYOUT_WRAPPER_NAMES } from '@markii/stdlib/editor';
export type { InsertableComponent } from '@markii/stdlib/editor';
// Re-exported so a host reading `InsertableComponent.attributes` names the
// type through this seam rather than reaching past it into `@markii/pack`.
export type { PackComponentAttribute } from '@markii/pack';
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

// Render-time diagnostics: one event from either renderer's `onDiagnostic`
// option becomes the one line both hosts write to their diagnostics
// surface.
export {
  createRenderDiagnosticCollector,
  createRenderDiagnosticReporter,
  renderDiagnosticLine,
} from './diagnostics/render-diagnostics.js';

// Batch 11: the HostAdapter contract, createMarkiiHost, and the Phase 1a
// shared behavior modules (docs pending — see tmp/W11-adapter-design.md).
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
export {
  promptsFromAdapter,
  runViaAdapter,
  spawnRunViaAdapter,
  RUN_TIMEOUT_MS as HOST_RUN_TIMEOUT_MS,
} from './host/run-behavior.js';
export type {
  RunViaAdapterRequest,
  RunViaAdapterResult,
} from './host/run-behavior.js';
export {
  formatRunFailureLines,
  runDiagnosticLines,
} from './host/run-diagnostics.js';

// Batch 11 Phase 1b: packs, export, and the editor seam.
export type { ArchiveExtractFs } from './host/pack-archive.js';
export {
  describeArchiveError,
  writeArchiveContents,
} from './host/pack-archive.js';
export type {
  InstallPackFromArchiveOptions,
  PackDirectoryExists,
} from './host/pack-install.js';
export {
  installConsentMessage,
  installPackDiagnosticLines,
  installPackFromArchive,
  installPackMessage,
  installReplaceConfirmMessage,
} from './host/pack-install.js';
export type { LoadPacksResult, PackDiscoveryIo } from './host/pack-load.js';
export {
  discoverConfiguredPacks,
  loadPacksViaAdapter,
  packDiscoveryIoFromAdapter,
} from './host/pack-load.js';
export { prebuiltShadowLine } from './packs/pack-diagnostics.js';
export type {
  ReadTerminalScriptsResult,
  TerminalPackScript,
} from './host/terminal-packs.js';
export {
  packHasTerminalViews,
  readTerminalPackScripts,
  terminalScriptMissingLine,
  terminalScriptNamespaceMismatchLine,
  terminalScriptRejectedLine,
  terminalScriptUnreadableLine,
} from './host/terminal-packs.js';
export type { RemovePackOutcome } from './host/pack-remove.js';

// The shared device-local pack trust list (docs/integration.md).
export type { PackTrustEntry, PackTrustList } from './packs/pack-trust.js';
export {
  DEFAULT_PACK_TRUST_LIST,
  MAX_TRUSTED_PACKS,
  PACK_TRUST_STORAGE_KEY,
  isPackTrusted,
  normalizePackTrustList,
  trustPack,
  untrustPack,
} from './packs/pack-trust.js';
export type {
  DisablePackOutcome,
  EnabledPack,
  EnablePackOutcome,
  InstalledPacksListing,
} from './host/pack-trust-behavior.js';
export {
  disablePackMessage,
  enablePackMessage,
  notEnabledPackDiagnosticLine,
  selectEnabledPacks,
} from './host/pack-trust-behavior.js';
export {
  removePackDiagnosticLine,
  removePackMessage,
  removePackViaAdapter,
} from './host/pack-remove.js';
export { mdPlainFromSource } from './host/export/md-plain.js';
export type {
  ExportHtmlDocumentRequest,
  NoteFileExportOutcome,
} from './host/export-behavior.js';
export {
  buildExportDocument,
  exportDefaultFileName,
  exportDiagnosticLines,
  exportNoteFileViaAdapter,
  exportResultMessage,
  fileNameOf,
  formatByteSize,
  imageEmbedDiagnosticLines,
  renderEngineDiagnosticLine,
} from './host/export-behavior.js';
export type {
  CatalogCache,
  CompletionPlan,
  InsertComponentEdit,
  InsertComponentPlan,
} from './host/editor-behavior.js';
export {
  LAYOUT_ORIGIN_TAG,
  STANDARD_ORIGIN_TAG,
  completeAtViaEditor,
  completionOriginTag,
  completionPlanAt,
  createCatalogCache,
  hoverAtViaEditor,
  hoverDocumentationText,
  insertComponentPlan,
  isContainerCompletionItem,
} from './host/editor-behavior.js';

export { createMarkiiHost } from './host/create-host.js';
export type {
  CompleteOutcome,
  EditorPositionRequest,
  ExportOutcome,
  ExportRequest,
  HoverOutcome,
  InsertComponentRequest,
  InstallPackOutcome,
  InstallPackRequest,
  LoadPacksOutcome,
  LoadTerminalPacksOutcome,
  MarkiiHost,
  MarkiiHostOptions,
  OpenOutcome,
  OpenRequest,
  RemovePackResult,
  DisablePackResult,
  EnablePackResult,
  InstalledPacksOutcome,
  RunOutcome,
  RunRequest,
  Unsupported,
} from './host/create-host.js';

export { joinPath, dirnamePath, isAbsolutePath } from './path-util.js';
