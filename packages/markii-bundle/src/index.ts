// This is @markii/bundle's browser-safe entry point: manifest handling, the
// path-jail, the zip storage form (fflate has no Node dependency), and the
// script capability view. The directory storage form touches `node:fs` and
// lives at the `@markii/bundle/fs` subpath instead (mirroring @markii/core's
// `./corpus` split), so a browser bundler consuming this package's main
// entry never has to reason about Node builtins reachable from it.

export type {
  BundleManifest,
  BundlePermissions,
  ManifestParseResult,
} from './manifest.js';
export {
  CURRENT_SPEC_VERSION,
  createDefaultManifest,
  parseManifest,
} from './manifest.js';

export type {
  BundleFsGrant,
  BundleWritePolicy,
  NormalizePathResult,
} from './paths.js';
export { isWriteAllowed, normalizeBundlePath } from './paths.js';

export type { BundleStorage } from './storage.js';
export { normalizeOrThrow } from './storage.js';

export {
  BundlePathError,
  BundleZipError,
  ScriptCapabilityError,
} from './errors.js';

export type { OpenZipBundleOptions } from './zip.js';
export {
  DEFAULT_MAX_ZIP_ENTRY_BYTES,
  DEFAULT_MAX_ZIP_TOTAL_BYTES,
  exportZipBundle,
  openZipBundle,
} from './zip.js';

export type { ScriptView } from './script-view.js';
export {
  createScriptView,
  grantAllDeclaredPermissions,
} from './script-view.js';
