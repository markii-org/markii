/**
 * `obsidian`-free half of fence auto-extension: turns `@markii/host`'s
 * `FenceLineEdit` data into the change shape `Editor.transaction` takes,
 * for the two places this plugin inserts a container directive on the
 * author's behalf (the Insert Markii component command, and accepting a
 * container from the completion suggester).
 *
 * They go into the SAME transaction as the insertion itself, which is what
 * makes the whole thing one undo step. Obsidian applies a transaction's
 * changes against the document as it was before the transaction, so every
 * position here stays in pre-edit coordinates, and none of these changes
 * overlaps the insertion (they are always on other lines).
 *
 * There is no wording and no user-visible surface here on purpose. Fence
 * extension is quiet: either the enclosing fences come out right, or
 * nothing extra happens. No notice, no marker, and never a blocked
 * insertion.
 */
import { fenceExtensionEdits } from '@markii/host';

/** Structurally an `obsidian` `EditorPosition`, named here so this module needs no `obsidian` import. */
export interface EditorPositionLike {
  readonly line: number;
  readonly ch: number;
}

/** Structurally an `obsidian` `EditorChange`, for `Editor.transaction`'s `changes`. */
export interface EditorChangeLike {
  readonly from: EditorPositionLike;
  readonly to: EditorPositionLike;
  readonly text: string;
}

/**
 * The fence rewrites that must accompany inserting `insertedText` at
 * `insertionLine`, or an empty array when there are none (which includes
 * every "do not touch" case `@markii/host`'s scanner refuses to act on,
 * and every non-container insertion).
 *
 * A change on `insertionLine` itself is dropped rather than returned: the
 * scanner cannot produce one, since an enclosing pair straddles the
 * insertion line by definition, but the insertion's own change lives on
 * that line and two overlapping changes in one transaction is not
 * something to leave to chance.
 *
 * Never throws: a failure to compute fence changes degrades to inserting
 * the component exactly as this plugin did before.
 */
export function fenceEditorChanges(
  documentText: string,
  insertionLine: number,
  insertedText: string,
): readonly EditorChangeLike[] {
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
      from: { line: edit.line, ch: edit.column },
      to: { line: edit.line, ch: edit.column + edit.oldText.length },
      text: edit.newText,
    }));
}
