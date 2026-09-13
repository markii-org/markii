// @markii/ansi: a framework-free terminal renderer for Markii documents. It
// consumes @markii/core's sanitized hast and emits a plain string (optionally
// carrying ANSI SGR/OSC 8 escapes) for a terminal, a pipe, or any host that
// wants text with no HTML and no React runtime. It is a third platform
// renderer alongside @markii/html and @markii/react.
export {
  renderMarkToAnsi,
  renderMarkNodeToAnsi,
  renderMarkInlineToAnsi,
  type RenderMarkOptions,
} from './render.js';
export {
  fg,
  colorize,
  bold,
  dim,
  italic,
  underline,
  inverse,
  hyperlink,
  detectColorLevel,
  resolveColorOption,
  type ColorLevel,
  type ColorOption,
  type AnsiColor,
} from './ansi.js';
export { defaultAnsiTheme, type AnsiTheme, type Tier1Token } from './theme.js';
export { style } from './style.js';
export {
  createAnsiRegistry,
  mergeAnsiRegistries,
  registryAliases,
  readRegistryComponent,
  resolveDirectiveAlias,
  REGISTRY_ALIASES,
  type DirectiveAttributes,
  type AnsiRegistry,
  type AnsiRegistryEntry,
  type AnsiComponent,
  type AnsiChildren,
  type AnsiChildPart,
  type AnsiChildrenOptions,
  type AnsiRenderContext,
  type RegistryAlias,
  type RegistryAliases,
  type ResolvedDirective,
  type ValueResolution,
} from './registry.js';
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
  failureToken,
  dataStateSuffix,
  emptyInlineTitle,
  invalidAttributeValueLabel,
  invalidAttributeValueTitle,
  unsafeImageSrcLabel,
  unsafeImageSrcTitle,
} from './failure-presentation.js';
export { stringifyStoredValue } from './value-format.js';
export { measure, stripAnsi } from './measure.js';
export {
  stripControlCharacters,
  sanitizeBlockText,
  sanitizeUrlText,
  BLOCK_TAB_WIDTH,
} from './sanitize.js';
export {
  wrap,
  pad,
  indentBlock,
  columns,
  frame,
  rule,
  type FrameOptions,
} from './box.js';
export {
  resolveLayoutAttributes,
  applyLayout,
  LAYOUT_ATTRIBUTE_KEYS,
  type ResolvedLayoutAttributes,
  type ResolvedLayoutPresets,
  type WidthPreset,
  type AlignPreset,
} from './layout.js';
export { type ResolveImageSrc } from './image-resolve.js';
export { type ResolveHref } from './href-resolve.js';
export type {
  AnsiValueStore,
  AnsiVaultStore,
  FailureKind,
  StoredValue,
  ValueStatus,
} from './value-types.js';
