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
export { defaultWorkerPath, spawnRun } from './run/run-host.js';

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

export type {
  BuildRenderRegistryResult,
  QueuedPackRegistration,
} from './packs/pack-render-registry.js';
export { buildRenderRegistry } from './packs/pack-render-registry.js';
