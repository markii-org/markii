// @markii/host/internal: the lower-level helpers this repository's own apps
// and `@markii/pack-build` build on. It carries NO semver promise: a name
// here can change or disappear in any release. An outside host should use
// the main entry. Environment-neutral like the main entry
// (`src/neutral-entries.probe.test.ts` bundles it for a browser).

export { mergeArrivingValue } from './values-merge.js';
export { isRunProgress } from './run/run-progress.js';
export { isNetBridgeRequest, serveNetRequest } from './run/net-bridge.js';
export type { NetBridgeReply } from './run/net-bridge.js';
export {
  MAX_VALUES_SNAPSHOT_BYTES,
  readPersistedValues,
  runOnce,
  valuesStorageKeyFor,
} from './run/run-flow.js';
export {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  clearGrantForDocument,
} from './run/grant-flow.js';
export {
  decodeBundleCacheFromStorage,
  encodeBundleCacheForStorage,
  withPersistedCache,
} from './run/bundle-run.js';
export {
  isBundleName,
  resolveBundleDocumentPath,
} from './run/bundle-document.js';
export { readLastRunTrace } from './run/run-trace.js';
export { staleValuesForRehydration } from './run/stale-values.js';
export {
  MARK_EXTENSION,
  buildNoteHtmlExport,
  composeNoteHtmlExport,
  noteHasScripts,
  exportBaseName,
  exportedSiblingPath,
} from './export/note-export.js';
export {
  EMPTY_IMAGE_REPORT,
  MAX_EMBEDDED_IMAGE_BYTES,
  embedImagesInHtml,
} from './export/image-embed.js';
export type {
  CascadeLinkResolver,
  CascadeNoteReader,
} from './export/cascade.js';
export type {
  CascadeArchiveRequest,
  CascadeExportOutcome,
} from './host/cascade-export-behavior.js';
export {
  buildCascadeArchive,
  cascadeDiagnosticLines,
  cascadeReasonOf,
  cascadeResultMessage,
} from './host/cascade-export-behavior.js';
export {
  componentsWithoutEngineView,
  declaredPackComponents,
  installedNamespaces,
} from './packs/discover.js';
export { loadPackModules } from './packs/pack-scripts.js';
export { relativePackEntries, resolvePackPaths } from './packs/pack-paths.js';
export {
  formatPackDiagnosticLines,
  skippedPackCount,
  prebuiltShadowLine,
} from './packs/pack-diagnostics.js';
export type { PackPathExists } from './packs/prebuilt.js';
export {
  PREBUILT_SCRIPT_FILENAME,
  PREBUILT_STYLESHEET_FILENAME,
  PREBUILT_TERMINAL_SCRIPT_FILENAME,
  emptyWebviewScript,
  resolvePrebuiltPack,
} from './packs/prebuilt.js';
export {
  createRenderDiagnosticCollector,
  createRenderDiagnosticReporter,
} from './diagnostics/render-diagnostics.js';
export { packsNotInstalledLabel } from './host/labels.js';
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
export { discoverConfiguredPacks } from './host/pack-load.js';
export {
  packHasTerminalViews,
  terminalScriptNamespaceMismatchLine,
  terminalScriptRejectedLine,
} from './host/terminal-packs.js';
export { mdPlainFromSource } from './host/export/md-plain.js';
export { exportDefaultFileName, fileNameOf } from './host/export-behavior.js';
export {
  completionOriginTag,
  isContainerCompletionItem,
} from './host/editor-behavior.js';
