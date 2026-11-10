/**
 * The `completeAt`/`hoverAt`/`insertComponent` behaviors' shared half,
 * merged from `apps/vscode/src/completion.ts` + `completion-catalog.ts`,
 * `apps/obsidian/src/complete-component.ts`, and both apps'
 * `insert-component.ts`.
 *
 * NODE-FREE by design: re-exported
 * from `../browser.ts` as well as `../index.ts`, so VS Code's webview
 * bundle can read the origin-tag vocabulary and the pure completion math
 * directly if a future slice needs to. `CatalogCache.get`'s injected
 * `load` is the one thing that reaches disk, and it is always supplied by
 * the caller (a main-entry-only pack-discovery call), never imported here.
 *
 * What stays app-side (deliberately): VS
 * Code's sectioned quick-pick presentation (`Standard`/`Layout`/`<pack>
 * pack` separators) and Obsidian's flat fuzzy list are a genuine product
 * difference, not duplication — this module returns the catalog and the
 * origin tag; it never picks a picker shape. Snippet escaping
 * (`snippetText`) is VS Code's own snippet-syntax concern and stays there
 * too. Hover exists only on VS Code today; a host with no `adapter.editor`
 * simply never calls `hoverAtViaAdapter`.
 */
import {
  closesOpenContainerFence,
  completionAt,
  componentDocumentation,
  fenceExtensionEdits,
  insertedContainerColonCount,
  formatComponentDocumentation,
  hoverAt,
  offsetToLineColumn,
  componentSkeleton,
} from '@markii/stdlib/editor';
import type {
  CompletionContext,
  CompletionItem,
  HoverInfo,
  InsertableComponent,
  LineColumn,
} from '@markii/stdlib/editor';
import type { HostEditor, HostTextEdit } from './adapter.js';

/** The origin tag every host's completion row shows for a component item: `'standard'`, `'layout'`, or the owning pack's own namespace. Empty string for an attribute or value item, which has no `group`. */
export const STANDARD_ORIGIN_TAG = 'standard';
export const LAYOUT_ORIGIN_TAG = 'layout';

/**
 * The origin tag a completion item carries: the lower-case
 * `'standard'`/`'layout'` strings above, or the pack name.
 */
export function completionOriginTag(item: CompletionItem): string {
  if (item.kind !== 'component') return '';
  if (item.group === 'standard') return STANDARD_ORIGIN_TAG;
  if (item.group === 'layout') return LAYOUT_ORIGIN_TAG;
  return item.packName ?? '';
}

/** A small cache in front of `buildComponentCatalog` (`../insert/component-catalog.js`), so a completion/hover provider does not re-discover packs from disk on every keystroke. */
export interface CatalogCache {
  /** The cached catalog, building it via `load` on first use and again after `invalidate()`. Never throws: a rejected `load` degrades to the standard-set-only catalog. */
  get(): Promise<readonly InsertableComponent[]>;
  /** The cached catalog if one is built, else `undefined`. Never starts a build. */
  peek(): readonly InsertableComponent[] | undefined;
  /** Drops the cached catalog (and any in-flight build), so the next `get()` rebuilds from `load`. */
  invalidate(): void;
}

/**
 * Builds a `CatalogCache` around `buildCatalog` (typically
 * `../insert/component-catalog.js`'s `buildComponentCatalog` composed with
 * a pack-discovery call). Concurrent `get()` calls made before a build
 * finishes share one in-flight promise rather than each starting their own
 * pack discovery.
 */
export function createCatalogCache(
  buildCatalog: () => Promise<readonly InsertableComponent[]>,
): CatalogCache {
  let cached: readonly InsertableComponent[] | undefined;
  let pending: Promise<readonly InsertableComponent[]> | undefined;

  async function build(): Promise<readonly InsertableComponent[]> {
    try {
      return await buildCatalog();
    } catch {
      return [];
    }
  }

  return {
    async get(): Promise<readonly InsertableComponent[]> {
      if (cached !== undefined) return cached;
      if (pending === undefined) {
        pending = build().then((catalog) => {
          cached = catalog;
          pending = undefined;
          return catalog;
        });
      }
      return pending;
    },
    peek(): readonly InsertableComponent[] | undefined {
      return cached;
    },
    invalidate(): void {
      cached = undefined;
      pending = undefined;
    },
  };
}

/** The line of `documentText` that `line` (zero-based) names, or `''` past the end of the document. */
function lineTextAt(documentText: string, line: number): string {
  return documentText.split('\n')[line] ?? '';
}

/**
 * `completionAt` composed over a `HostEditor`'s document text, at the
 * POSITION a completion request names — not `editor.cursor()`. A real
 * editor's completion provider is invoked with an explicit position (the
 * position the user is typing at when the provider fires), which is why a
 * completion/hover request always carries its own `line`/`column` rather
 * than reading the live caret a second time. `editor.cursor()` stays
 * reserved for `insertComponentPlan`, which genuinely inserts at the
 * caret.
 */
export function completeAtViaEditor(
  editor: Pick<HostEditor, 'documentText'>,
  position: LineColumn,
  catalog: readonly InsertableComponent[],
): CompletionContext {
  const line = lineTextAt(editor.documentText(), position.line);
  return completionAt(line, position.column, catalog);
}

/**
 * Everything a completion UI needs for one request, decided once in the
 * shared layer: the items, the replace span (`replaceStart`/`replaceEnd`),
 * the token start a filtering popup should score against (`tokenStart`,
 * which equals `replaceStart` unless a colon run precedes the name), and
 * the fence lengthening edits an accepted CONTAINER item needs. Hosts only
 * map this onto their own popup type.
 */
export interface CompletionPlan {
  readonly kind: CompletionContext['kind'];
  readonly items: readonly CompletionItem[];
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly tokenStart: number;
  /**
   * Fence rewrites to apply in the SAME undo step as an accepted container
   * item, in pre-edit coordinates, never on the insertion line. Empty when
   * no item in the response opens a container or the document's fences do
   * not pair cleanly. Every container item in one context inserts the same
   * fence shape, so one list serves them all; a host applies it only when
   * the accepted item is a container (`isContainerCompletionItem`).
   */
  readonly fenceEdits: readonly HostTextEdit[];
}

/** Whether accepting `item` opens a container, and so needs `CompletionPlan.fenceEdits` applied with it. */
export function isContainerCompletionItem(item: {
  readonly insertText: string;
}): boolean {
  try {
    return insertedContainerColonCount(item.insertText) !== undefined;
  } catch {
    return false;
  }
}

/**
 * `completionAt` over a whole document at a position, plus the two
 * decisions both editors used to repeat at their own trigger boundary: a
 * bare colon run that CLOSES an open container is not an opener waiting
 * for a name (so no plan), and fence edits are computed once per response.
 * Returns `undefined` when there is nothing to offer. Never throws.
 */
export function completionPlanAt(
  documentText: string,
  position: LineColumn,
  catalog: readonly InsertableComponent[],
): CompletionPlan | undefined {
  try {
    const line = lineTextAt(documentText, position.line);
    if (closesOpenContainerFence(documentText, position.line, line)) {
      return undefined;
    }
    const context = completionAt(line, position.column, catalog);
    if (context.kind === 'none' || context.items.length === 0) {
      return undefined;
    }
    const container = context.items.find(isContainerCompletionItem);
    let fenceEdits: readonly HostTextEdit[] = [];
    if (container !== undefined) {
      try {
        fenceEdits = fenceExtensionEdits(
          documentText,
          position.line,
          container.insertText,
        )
          .filter((edit) => edit.line !== position.line)
          .map((edit) => ({
            line: edit.line,
            startColumn: edit.column,
            endColumn: edit.column + edit.oldText.length,
            text: edit.newText,
          }));
      } catch {
        fenceEdits = [];
      }
    }
    return {
      kind: context.kind,
      items: context.items,
      replaceStart: context.replaceStart,
      replaceEnd: context.replaceEnd,
      tokenStart: context.tokenStart ?? context.replaceStart,
      fenceEdits,
    };
  } catch {
    return undefined;
  }
}

/** `hoverAt` composed over a `HostEditor`'s document text at a given position, the same way `completeAtViaEditor` composes `completionAt`. */
export function hoverAtViaEditor(
  editor: Pick<HostEditor, 'documentText'>,
  position: LineColumn,
  catalog: readonly InsertableComponent[],
): HoverInfo | undefined {
  const line = lineTextAt(editor.documentText(), position.line);
  return hoverAt(line, position.column, catalog);
}

/**
 * Plain-text hover documentation for `item`: `@markii/stdlib/editor`'s
 * `formatComponentDocumentation`, the shape every host without a
 * rich-markdown hover surface (or a host doing its own markdown mapping)
 * can use as-is. This is also what `createMarkiiHost`'s `hoverAt` returns
 * (via `hoverAtViaEditor`'s `HoverInfo.documentation`) rather than the
 * bare summary sentence: the summary alone can read as generic prose with
 * no component name in it (a callout's summary is "A colored box for an
 * aside, warning, or danger note.", nowhere mentioning "callout"), while
 * the formatted text's `Example: :::callout{}` line always names the
 * directive.
 */
export function hoverDocumentationText(item: InsertableComponent): string {
  return formatComponentDocumentation(componentDocumentation(item));
}

/** One text edit and the cursor position an insertion leaves behind, both relative to the document `insertionLine`/`insertionColumn` named. */
export interface InsertComponentEdit {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly text: string;
}

export interface InsertComponentPlan {
  /**
   * Every edit `HostEditor.applyEdits` must apply together as one
   * undoable edit: the skeleton insertion plus any fence lines an
   * enclosing container needs lengthened.
   *
   * All edits are expressed in the ORIGINAL document's coordinates (the
   * text `documentText` named, before any of these edits land) — exactly
   * like `fenceExtensionEdits` already promises, and exactly what both
   * apps' `HostTextEdit`-consuming adapters already assume of a
   * multi-edit `applyEdits` call. That is what makes the array safe to
   * apply as one atomic transaction: a host whose `applyEdits` resolves
   * every position against the pre-edit document (VS Code's
   * `WorkspaceEdit`, Obsidian's `Editor.transaction`) can apply them in
   * any order.
   *
   * The array is ALSO returned bottom-to-top (descending by line, ties
   * broken by descending column) as a second-line defense for a simpler
   * host: one that applies this list as a sequence of plain string
   * splices against a single mutable buffer rather than a coordinate-free
   * transaction. Splicing text at a line shifts every line and column
   * number below it; splicing from the bottom of the document upward
   * means each edit is always applied before anything that could move
   * out from under it, and nothing below an edit's line is ever touched
   * after that edit lands. Fence edits never land on the insertion line
   * itself (`fenceExtensionEdits`'s own guarantee, an enclosing pair by
   * definition straddles it), so the insertion edit's own line never
   * collides with a fence edit's line and the ordering rule never has to
   * break a tie between them.
   */
  readonly edits: readonly InsertComponentEdit[];
  readonly cursor: LineColumn;
}

/**
 * Builds the skeleton for `component` (`@markii/stdlib/editor`'s
 * `componentSkeleton`), turns its flat `cursorOffset` into an absolute
 * line/column given where the insertion happens, and folds in the fence
 * edits (`@markii/stdlib/editor`'s `fenceExtensionEdits`) an enclosing
 * container needs lengthened so it still nests legally. This is the pure
 * half of both apps' `insert-component.ts` command handlers: build the
 * skeleton, insert it at the cursor, lengthen any enclosing fences, place
 * the cursor inside it — all in one plan a host applies as one undoable
 * edit (`HostEditor.applyEdits`'s contract).
 *
 * `documentText` is the document as it stands before this insertion (the
 * same text `fenceExtensionEdits` scans); a caller inserting from a
 * completion accept passes the same text it already read to decide what
 * to insert.
 *
 * Never throws: a failure to compute fence edits (hostile input, an
 * unpaired document `fenceExtensionEdits` refuses to touch) degrades to
 * the skeleton insertion alone, exactly as inserting always worked before
 * fence auto-extension existed.
 */
export function insertComponentPlan(
  component: Pick<InsertableComponent, 'directiveName' | 'kind'> & {
    readonly requiredAttributes?: readonly string[];
  },
  documentText: string,
  insertionLine: number,
  insertionColumn: number,
): InsertComponentPlan {
  const skeleton = componentSkeleton(
    component.directiveName,
    component.kind,
    component.requiredAttributes ?? [],
  );
  const relative = offsetToLineColumn(skeleton.text, skeleton.cursorOffset);
  const cursor: LineColumn =
    relative.line === 0
      ? { line: insertionLine, column: insertionColumn + relative.column }
      : { line: insertionLine + relative.line, column: relative.column };

  const insertionEdit: InsertComponentEdit = {
    line: insertionLine,
    startColumn: insertionColumn,
    endColumn: insertionColumn,
    text: skeleton.text,
  };

  let fenceEdits: readonly InsertComponentEdit[];
  try {
    fenceEdits = fenceExtensionEdits(documentText, insertionLine, skeleton.text)
      .filter((edit) => edit.line !== insertionLine)
      .map((edit) => ({
        line: edit.line,
        startColumn: edit.column,
        endColumn: edit.column + edit.oldText.length,
        text: edit.newText,
      }));
  } catch {
    fenceEdits = [];
  }

  const edits = [...fenceEdits, insertionEdit].sort((a, b) =>
    a.line !== b.line ? b.line - a.line : b.startColumn - a.startColumn,
  );

  return { edits, cursor };
}
