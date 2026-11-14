// @markii/ansi: a terminal renderer for Markii documents, built on Ink. It
// consumes @markii/core's sanitized hast and emits a plain string (optionally
// carrying ANSI SGR/OSC 8 escapes) for a terminal, a pipe, or any host that
// wants text with no HTML runtime — plus, for a live viewer, the Ink element
// tree itself (`buildMarkElement`). It is a third platform renderer alongside
// @markii/html and @markii/react.
//
// This entry is the package's semver promise: the render entry points, the
// registry and pack-loading seam, the types a pack's terminal view names, and
// the `TERMINAL_*_GLOBAL` names that form the terminal pack ABI. The escape
// helpers, failure wording, sanitizers and layout helpers stay inside the
// package.
export {
  renderMarkToAnsi,
  renderMarkNodeToAnsi,
  renderMarkInlineToAnsi,
  buildMarkElement,
  type RenderCode,
  type RenderCodeBlock,
  type RenderMarkOptions,
} from './render.js';
export {
  detectColorLevel,
  resolveColorOption,
  type ColorLevel,
  type ColorOption,
} from './ansi.js';
export { defaultAnsiTheme, type AnsiTheme, type Tier1Token } from './theme.js';
export type { BoxStyle, GlyphSet } from './glyphs.js';
export type {
  DirectiveAttributes,
  AnsiRegistry,
  AnsiRegistryEntry,
  AnsiComponent,
  AnsiComponentProps,
  AnsiRenderContext,
  ValueResolution,
} from './registry.js';
export { type ResolveImageSrc } from './image-resolve.js';
export { type ResolveHref } from './href-resolve.js';
export type {
  AnsiValueStore,
  AnsiVaultStore,
  FailureKind,
  StoredValue,
  ValueStatus,
} from './value-types.js';
export { defaultAnsiRegistry } from './components/index.js';
export {
  installAnsiPacks,
  type AnsiPackComponentModules,
  type AnsiPackToInstall,
  type InstallAnsiPacksResult,
} from './pack-loader.js';
export {
  loadTerminalPackScript,
  installTerminalPackGlobals,
  TERMINAL_REGISTER_GLOBAL,
  TERMINAL_REACT_GLOBAL,
  TERMINAL_INK_GLOBAL,
  type LoadTerminalPackScriptResult,
} from './pack-script.js';
