/**
 * `@markii/stdlib/editor`: the pure, host-neutral editor helpers every
 * Markii editor integration (VS Code, Obsidian, or a third-party host) is
 * built on — directive completion and hover, the "Insert Component"
 * skeleton builder and standard-set catalog, and fence auto-extension.
 *
 * This subpath, not `@markii/core`, is the home for these helpers because
 * every one of them reads `@markii/stdlib` contract data (component kinds,
 * required attributes, the layout vocabulary) and none of them touches
 * `@markii/core`'s parser at all. Putting them on `@markii/core` would give
 * the component-agnostic parser a dependency on component contracts, which
 * is against architecture rule 1's intent (AGENTS.md); `@markii/stdlib` is
 * already the zero-dependency contract seam every renderer implements
 * against, so it is the natural home for the matching editor seam too.
 *
 * A pack-aware host composes a full catalog by appending its own pack
 * entries after `standardComponentCatalog()`'s standard-set list (see
 * `@markii/host`'s `insert/component-catalog.ts` for the reference
 * composition); nothing in this subpath imports `@markii/pack`, so a host
 * with no packs at all pays for none of it.
 */
export type {
  CompletionContext,
  CompletionContextKind,
  CompletionItem,
  CompletionItemKind,
  ComponentDocumentation,
  HoverInfo,
} from './complete/types.js';
export {
  completionAt,
  componentDocumentation,
  formatComponentDocumentation,
  hoverAt,
} from './complete/completion.js';
export type {
  AttributeNameParseResult,
  AttributeValueParseResult,
  DirectiveForm,
  DirectiveNameParseResult,
  DirectiveNameToken,
  ParsedCompletionContext,
} from './complete/directive-context.js';
export {
  clampColumn,
  findDirectiveNameTokenAt,
  parseCompletionContext,
} from './complete/directive-context.js';

export type {
  EditorComponentAttribute,
  InsertableComponent,
} from './insert/component-catalog.js';
export {
  LAYOUT_WRAPPER_NAMES,
  standardComponentCatalog,
} from './insert/component-catalog.js';
export type {
  ComponentSkeleton,
  LineColumn,
} from './insert/component-skeleton.js';
export {
  componentSkeleton,
  offsetToLineColumn,
} from './insert/component-skeleton.js';
export { firstSentence } from './insert/first-sentence.js';

export type {
  EnclosingContainerFence,
  FenceLineEdit,
} from './fences/container-fences.js';
export {
  closesOpenContainerFence,
  enclosingContainerFences,
  fenceExtensionEdits,
  insertedContainerColonCount,
} from './fences/container-fences.js';
