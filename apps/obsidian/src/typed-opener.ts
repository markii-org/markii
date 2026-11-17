/**
 * Obsidian-free logic behind fence lengthening for a hand-typed container
 * opener. `main.ts` calls `typedOpenerChanges` when the editor reports a
 * change that followed a typed Enter, and applies the result in one editor
 * transaction. The Enter key is the signal: undo, redo, a paste and every
 * programmatic edit arrive without it, so they never rewrite text the author
 * did not just type.
 */
import type { HostTextEdit, MarkiiHost } from '@markii/host';

/** One change in the shape `Editor.transaction` takes. */
export interface TypedOpenerChange {
  readonly from: { readonly line: number; readonly ch: number };
  readonly to: { readonly line: number; readonly ch: number };
  readonly text: string;
}

/** `Editor.transaction` changes for the line above the cursor, or an empty list when there is nothing to lengthen. */
export function typedOpenerChanges(
  host: Pick<MarkiiHost, 'typedOpenerAt'>,
  documentText: string,
  cursorLine: number,
): readonly TypedOpenerChange[] {
  if (cursorLine < 1) return [];
  const outcome = host.typedOpenerAt({
    line: cursorLine - 1,
    documentText,
  });
  if (outcome.kind !== 'fence-edits') return [];
  return outcome.fenceEdits.map((edit: HostTextEdit) => ({
    from: { line: edit.line, ch: edit.startColumn },
    to: { line: edit.line, ch: edit.endColumn },
    text: edit.text,
  }));
}
