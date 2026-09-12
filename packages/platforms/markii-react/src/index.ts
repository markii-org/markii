// This is @markii/react's renderer-only entry point ("."): `renderMark` and
// the registry types/helpers, with NO import of `./components` — a consumer
// who brings their own registry (via `createRegistry`/`mergeRegistries`)
// does not pull in the standard component set (Callout, Stat, ...) or
// `doc.css` merely by importing from here. It DOES pull in
// `@markii/stdlib`: `./layout.ts`'s width and align presets and
// `./render.tsx`'s contract lookup are value imports on the render path
// itself, so `@markii/stdlib` is a real dependency of this entry, not an
// opt-in of the standard component set. The batteries-included standard
// components + `defaultRegistry` live at the `@markii/react/components`
// subpath instead (see `./components/index.ts`).
export {
  renderMark,
  renderMarkNode,
  renderMarkInline,
  type RenderMarkOptions,
} from './render.js';
export { type ResolveImageSrc } from './image-resolve.js';
export { type ResolveHref } from './href-resolve.js';
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
  type LoadPackResult,
} from './pack-loader.js';
