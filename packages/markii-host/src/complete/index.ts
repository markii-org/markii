/**
 * Directive autocompletion (GitHub issue #27, slice 1): the public surface
 * both hosts' completion providers import. See `./completion.ts` for
 * `completionAt`/`hoverAt`, `./documentation.ts` for
 * `componentDocumentation`/`formatComponentDocumentation`, and `./types.ts`
 * for the shared contract types.
 */
export type {
  CompletionContext,
  CompletionContextKind,
  CompletionItem,
  CompletionItemKind,
  ComponentDocumentation,
  HoverInfo,
} from './types.js';
export {
  completionAt,
  componentDocumentation,
  formatComponentDocumentation,
  hoverAt,
} from './completion.js';
