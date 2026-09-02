// This is @markii/react's renderer-only entry point ("."): `renderMark` and
// the registry types/helpers, with NO import of `./components` — a consumer
// who brings their own registry (via `createRegistry`/`mergeRegistries`)
// must not pull in the standard component set (Callout, Stat, ...), their
// `@markii/stdlib` dependency, or `doc.css` merely by importing from here.
// The batteries-included standard components + `defaultRegistry` live at
// the `@markii/react/components` subpath instead (see `./components/index.ts`).
export {
  renderMark,
  renderMarkNode,
  type RenderMarkOptions,
} from './render.js';
export { type ResolveImageSrc } from './image-resolve.js';
export {
  createRegistry,
  mergeRegistries,
  registryAliases,
  resolveDirectiveAlias,
  REGISTRY_ALIASES,
  type DirectiveAttributes,
  type Registry,
  type RegistryAlias,
  type RegistryAliases,
  type RegistryEntry,
  type ResolvedDirective,
  type MarkComponentProps,
} from './registry.js';
export {
  REACT_ENGINE_ID,
  loadPack,
  installPacks,
  type PackComponentModules,
  type PackToInstall,
  type InstallPacksResult,
} from './pack-loader.js';
