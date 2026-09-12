/**
 * Directive autocompletion (GitHub issue #27, slice 1): the public types
 * both `completionAt`/`hoverAt` (`./completion.ts`) and
 * `componentDocumentation`/`formatComponentDocumentation`
 * (`./documentation.ts`) are built against. Kept in their own module so
 * neither of those implementation files has to import the other just to
 * share a type — this is the one seam every editor host (a `@markii/*`
 * host in this repo, or a third-party one importing `@markii/stdlib/editor`
 * directly) codes against, so its names and shapes are a contract, not an
 * implementation detail.
 */

/** What a completion item inserts and where it came from. */
export type CompletionItemKind = 'component' | 'attribute' | 'value';

/** Structured documentation for a component or attribute, so a host can render it its own way. */
export interface ComponentDocumentation {
  /** Full prose: a standard component's contract description, a pack component's declared description, or an attribute's description. Empty string when none is available. */
  readonly summary: string;
  /** One line per attribute, e.g. `type (required): info | warning | danger`. Empty for an attribute's own documentation. */
  readonly attributes: readonly string[];
  /** A one-line usage example built from the skeleton builder, e.g. `:::callout{}`. Empty when there is nothing useful to show. */
  readonly example: string;
}

export interface CompletionItem {
  /** What the picker shows and filters on: a directive name, an attribute name, or an attribute value. */
  readonly label: string;
  readonly kind: CompletionItemKind;
  /** One short line for the row's secondary text. May be empty. */
  readonly detail: string;
  /** Structured docs, when there are any. */
  readonly documentation?: ComponentDocumentation;
  /** The exact PLAIN text that replaces the context's range. Never a snippet, never host-specific syntax. */
  readonly insertText: string;
  /** Character offset within `insertText` where the cursor should land afterward. Same convention as `componentSkeleton`'s `cursorOffset`. */
  readonly insertCursorOffset: number;
  /** Present on a `component` item: which catalog group it came from, so a host can render its own origin tag. */
  readonly group?: 'standard' | 'layout' | 'pack';
  /** Present on a `component` item from a pack. */
  readonly packName?: string;
}

export type CompletionContextKind =
  'none' | 'directive-name' | 'attribute-name' | 'attribute-value';

export interface CompletionContext {
  readonly kind: CompletionContextKind;
  /**
   * Zero-based column an accepted item's `insertText` replaces FROM. Equals
   * `replaceEnd` when `kind` is `'none'`.
   *
   * `replaceStart` and `tokenStart` answer two different questions and a
   * host that uses one for the other's job gets a working-looking popup
   * that silently filters everything out (GitHub issue #50). `replaceStart`
   * is the REPLACE-RANGE start: for a `'directive-name'` context on an
   * otherwise-empty rest of the line, it sits at the start of the COLON RUN
   * (`:::`), not at the directive name, because accepting an item there
   * replaces the whole fence with the chosen component's skeleton. A host
   * that also uses this value as the text a popup FILTERS candidates
   * against (CodeMirror's `CompletionResult.from` is exactly that) ends up
   * comparing the typed text `":::cal"` against labels like `"callout"`:
   * the leading colons never match, and the popup opens empty. Use
   * `tokenStart` for filtering; use `replaceStart` for the edit.
   */
  readonly replaceStart: number;
  /** Zero-based column the replacement ends at. */
  readonly replaceEnd: number;
  /**
   * Zero-based column where the NAME token itself starts, i.e. `replaceStart`
   * plus the colon run's length for a `'directive-name'` context (for
   * `:::cal` with `replaceStart` 0, `tokenStart` is 3). This is the value a
   * filtering completion host (one that scores candidates against the
   * text between its own `from` and the cursor) should hand back as that
   * `from`, since candidate labels never carry the leading colons.
   * `undefined` for every other context kind, where `replaceStart` already
   * sits at the token being replaced and there is nothing separate to name.
   */
  readonly tokenStart?: number;
  readonly items: readonly CompletionItem[];
}

export interface HoverInfo {
  readonly directiveName: string;
  readonly documentation: ComponentDocumentation;
  /** Zero-based columns of the directive name token being hovered, for a host that highlights the range. */
  readonly start: number;
  readonly end: number;
}
