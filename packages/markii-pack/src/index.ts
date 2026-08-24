// @markii/pack: the neutral component-pack contract (docs/packs.md). This
// is slice 0 of issue #3 — the manifest shape, namespace/engine rules, and
// hand-rolled validation only. No registry loading, no `uses:` surfacing,
// no sandboxed `require`, no filesystem reads: those are later slices.

export type { PackManifest, PackManifestParseResult } from './manifest.js';
export { parsePackManifest } from './manifest.js';

export type {
  ComposeDirectiveNameResult,
  NamespaceCollision,
  NamespaceValidationResult,
} from './namespace.js';
export {
  RESERVED_NAMESPACE_SEGMENTS,
  composeDirectiveName,
  detectNamespaceCollisions,
  validateLocalComponentName,
  validatePackName,
} from './namespace.js';

export type { UsesResolution } from './uses.js';
export { isValidPackNameShape, resolveUses } from './uses.js';
