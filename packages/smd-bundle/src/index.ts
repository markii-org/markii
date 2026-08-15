// This is smd-bundle's browser-safe entry point: manifest handling, the
// path-jail, the zip storage form (fflate has no Node dependency), and the
// script capability view. The directory storage form touches `node:fs` and
// lives at the `smd-bundle/fs` subpath instead (mirroring smd-core's
// `./corpus` split), so a browser bundler consuming this package's main
// entry never has to reason about Node builtins reachable from it.

export type {
  BundleManifest,
  BundlePermissions,
  ManifestParseResult,
} from './manifest';
export {
  CURRENT_SPEC_VERSION,
  createDefaultManifest,
  parseManifest,
} from './manifest';

export type {
  BundleFsGrant,
  BundleWritePolicy,
  NormalizePathResult,
} from './paths';
export { isWriteAllowed, normalizeBundlePath } from './paths';

export type { BundleStorage } from './storage';
export { normalizeOrThrow } from './storage';

export {
  BundlePathError,
  BundleZipError,
  ScriptCapabilityError,
} from './errors';

export { exportZipBundle, openZipBundle } from './zip';

export type { ScriptView } from './script-view';
export { createScriptView } from './script-view';
