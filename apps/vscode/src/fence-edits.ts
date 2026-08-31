/**
 * `vscode`-free half of fence auto-extension: turns `@markii/host`'s
 * `FenceLineEdit` data into the line/column spans `extension.ts` hands to
 * `vscode.TextEdit`, for the two places this extension inserts a container
 * directive on the author's behalf (the `markii.insertComponent` command,
 * and accepting a container item from the completion popup).
 *
 * There is no wording and no user-visible surface here on purpose. Fence
 * extension is quiet: either the enclosing fences come out right, or
 * nothing extra happens. It never reports, never prompts, and never
 * blocks the insertion it accompanies.
 */
import { fenceExtensionEdits, insertedContainerColonCount } from '@markii/host';

/** One fence rewrite as a zero-based line and column span, ready for a `vscode.Range`. */
export interface FenceTextEdit {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly newText: string;
}

/**
 * The fence rewrites that must accompany inserting `insertedText` at
 * `insertionLine`, or an empty array when there are none (which includes
 * every "do not touch" case `@markii/host`'s scanner refuses to act on).
 *
 * Edits on `insertionLine` itself are dropped rather than returned. The
 * scanner cannot produce one (an enclosing pair straddles the insertion
 * line by definition), but a completion item's `additionalTextEdits` must
 * not overlap its own replace range, and that range always lives on the
 * insertion line. Enforcing it here makes the invariant local to the file
 * that depends on it.
 *
 * Never throws: a failure to compute fence edits degrades to inserting
 * the component exactly as this extension did before.
 */
export function fenceTextEdits(
  documentText: string,
  insertionLine: number,
  insertedText: string,
): readonly FenceTextEdit[] {
  let edits: readonly {
    line: number;
    column: number;
    oldText: string;
    newText: string;
  }[];
  try {
    edits = fenceExtensionEdits(documentText, insertionLine, insertedText);
  } catch {
    return [];
  }

  return edits
    .filter((edit) => edit.line !== insertionLine)
    .map((edit) => ({
      line: edit.line,
      startColumn: edit.column,
      endColumn: edit.column + edit.oldText.length,
      newText: edit.newText,
    }));
}

/** Whether accepting `insertText` would open a container, and so needs the enclosing fences lengthened. */
export function isContainerInsertText(insertText: string): boolean {
  try {
    return insertedContainerColonCount(insertText) !== undefined;
  } catch {
    return false;
  }
}

/**
 * The fence rewrites for a whole completion response, computed once.
 *
 * Every container item in one completion context inserts the same fence
 * shape: `completionAt` gives them all the colon run the author typed, so
 * the edits are identical across them and only the container items need
 * them at all. Computing them per item would re-read and re-scan the whole
 * document once per row of the popup, on every keystroke that reopens it.
 *
 * `readDocumentText` is a thunk so a response with no container item never
 * reads the document at all.
 */
export function completionFenceTextEdits(
  readDocumentText: () => string,
  insertionLine: number,
  items: readonly { readonly insertText: string }[],
): readonly FenceTextEdit[] {
  const container = items.find((item) =>
    isContainerInsertText(item.insertText),
  );
  if (!container) return [];
  let documentText: string;
  try {
    documentText = readDocumentText();
  } catch {
    return [];
  }
  return fenceTextEdits(documentText, insertionLine, container.insertText);
}
