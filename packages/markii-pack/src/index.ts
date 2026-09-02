// @markii/pack: the neutral component-pack contract (docs/packs.md). This
// started as slice 0 of issue #3 — the manifest shape, namespace/engine
// rules, and hand-rolled validation only, with no registry loading, no
// `uses:` surfacing, no sandboxed `require`, and no filesystem reads. Issue
// #16's `.mkp` archive reader (`./archive.ts`) is the first filesystem-
// adjacent slice: it reads validated bytes in and returns parsed contents
// out, touching no real filesystem itself (a host does that).

export type { PackManifest, PackManifestParseResult } from './manifest.js';
export { parsePackManifest } from './manifest.js';

export type {
  OpenPackArchiveOptions,
  OpenPackArchiveResult,
  PackArchiveContents,
  PackArchiveError,
} from './archive.js';
export { openPackArchive, packArchiveFileName } from './archive.js';

export type {
  PackComponentAttribute,
  PackComponentDefinition,
  PackComponentEntry,
  PackComponentKind,
  PackComponentListing,
  ResolvedPackComponent,
} from './components.js';
export {
  PACK_ATTRIBUTE_NAME_PATTERN,
  PACK_COMPONENT_KINDS,
  isPackAttributeName,
  packComponents,
  resolvePackComponent,
} from './components.js';

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
