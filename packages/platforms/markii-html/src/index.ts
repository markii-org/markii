// @markii/html: a framework-free static HTML renderer for Markii documents.
// It consumes @markii/core's sanitized hast and emits an HTML string, so a
// stopped-changing document can be rendered for publishing, CI, email, or an
// archive with no React runtime. It is one platform renderer among possible
// many; the React renderer (@markii/react) is another consumer of the same core.
export {
  renderMarkToHtml,
  renderMarkNodeToHtml,
  type RenderMarkOptions,
} from './render.js';
export { type ResolveImageSrc } from './image-resolve.js';
export { escapeHtml } from './escape.js';
export {
  exportHtmlDocument,
  type ExportHtmlDocumentOptions,
} from './document.js';
export {
  resolveStorePath,
  resolveScopedPath,
  VAULT_NAME_PREFIX,
  type StorePathResolution,
  type ValueScope,
} from './resolve.js';
export {
  failurePhrase,
  failureTitle,
  failureKindClass,
  dataStateClassName,
} from './failure-presentation.js';
export { stringifyStoredValue } from './value-format.js';
export {
  createHtmlRegistry,
  mergeHtmlRegistries,
  registryAliases,
  readRegistryComponent,
  resolveDirectiveAlias,
  REGISTRY_ALIASES,
  type DirectiveAttributes,
  type HtmlRegistry,
  type HtmlRegistryEntry,
  type HtmlComponent,
  type HtmlRenderContext,
  type RegistryAlias,
  type RegistryAliases,
  type ResolvedDirective,
  type ValueResolution,
} from './registry.js';
export {
  resolveLayoutAttributes,
  LAYOUT_ATTRIBUTE_KEYS,
  type ResolvedLayoutAttributes,
} from './layout.js';
