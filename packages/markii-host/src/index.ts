// @markii/host: the main entry. It carries what a host author needs to
// write a host against `createMarkiiHost`: the factory, the adapter and its
// capability groups, the request and outcome types, the labels type, the
// outcome wording helpers, bundle snapshots and pack discovery.
//
// Environment-neutral: nothing reachable from this entry imports `node:*`,
// `esbuild-wasm`, `@markii/react` or `@markii/html` at runtime
// (`src/neutral-entries.probe.test.ts` bundles it for a browser to prove it).
// What needs Node lives in `./node.ts`; this repository's own apps reach the
// lower-level helpers through `./internal.ts`, which carries no semver
// promise. The editor seam is `@markii/stdlib/editor`, imported directly.
//
// This is the security-critical layer (tier gating, the grant model,
// address pinning, the terminatable-isolate watchdog): one copy lives here
// so no app grows a drifting second one.

export type { ValuesFailure } from './values-failure.js';
export type {
  RunJob,
  RunResult,
  RunFailure,
  SpawnRunOptions,
  SpawnRunRequest,
} from './run/run-host.js';
export type {
  IsolateSpawner,
  RunIsolate,
  SpawnIsolateOptions,
} from './run/isolate.js';
export type { RunOnceOptions, RunOnceResult } from './run/run-flow.js';
export type {
  GrantMemento,
  PromptHost,
  PromptManyHosts,
  PromptUnknownHosts,
  Thenable,
} from './run/grant-flow.js';
export type {
  BuildBundleSnapshotOptions,
  BundleSnapshotResult,
} from './run/bundle-run.js';
export { buildBundleSnapshot } from './run/bundle-run.js';
export type { RunTrace } from './run/run-trace.js';
export type {
  HtmlExportEngine,
  ExportBodyRenderer,
  ExportBodyResult,
  ExportPackStylesheet,
  ExportRenderInfo,
  StaticExportReason,
} from './export/note-export.js';
export type {
  EmbeddedImageReport,
  ExportImageReader,
  ExportImageResult,
  ImageSkipReason,
  SkippedImage,
} from './export/image-embed.js';
export type { PinPolicy } from './run/net-pinning.js';
export type { PackModulesMap } from './run/lua-resolver.js';
export type {
  DiscoveredPack,
  DiscoverPacksResult,
  EngineUnsupportedPack,
  PackDirectoryLister,
  SkippedPackFolder,
} from './packs/discover.js';
export { discoverPacks } from './packs/discover.js';
export type {
  BuildRenderRegistryResult,
  DuplicateComposedName,
  PackRegistryEngine,
  QueuedPackRegistration,
} from './packs/pack-render-registry.js';
export { buildRenderRegistry } from './packs/pack-render-registry.js';
export { buildComponentCatalog } from './insert/component-catalog.js';
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
export type {
  RunViaAdapterRequest,
  RunViaAdapterResult,
} from './host/run-behavior.js';
export { installPackMessage } from './host/pack-install.js';
export type { PackDiscoveryIo } from './host/pack-load.js';
export type { TerminalPackScript } from './host/terminal-packs.js';
export type { RemovePackOutcome } from './host/pack-remove.js';
export type {
  DisablePackOutcome,
  EnabledPack,
  EnablePackOutcome,
  InstalledPacksListing,
} from './host/pack-trust-behavior.js';
export {
  disablePackMessage,
  enablePackMessage,
} from './host/pack-trust-behavior.js';
export { removePackMessage } from './host/pack-remove.js';
export { exportResultMessage } from './host/export-behavior.js';
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
export { netRefusal } from './run/net-refusal.js';
