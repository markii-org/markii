/**
 * `vscode`-free decision behind fence lengthening for a hand-typed container
 * opener. `extension.ts` calls it for each document change and, when it
 * names a line, asks `@markii/host`'s `typedOpenerAt` for the edits.
 *
 * Only a bare Enter counts: one change that inserts a line break and at
 * most the auto-indent that follows it, replacing nothing. Undo, redo, a
 * pasted block and any programmatic edit carry a change reason or a
 * longer text, so they never trigger a rewrite of text the author did not
 * just type.
 */

/** The part of `vscode.TextDocumentContentChangeEvent` this decision reads. */
export interface TypedChangeLike {
  readonly rangeLength: number;
  readonly text: string;
  readonly range: { readonly start: { readonly line: number } };
}

const BARE_NEWLINE = /^\r?\n[ \t]*$/;

/**
 * The zero-based line the author just finished, or `undefined` when the
 * change is not a typed Enter. `reason` is `TextDocumentChangeEvent.reason`:
 * it is `undefined` for ordinary typing and set for undo and redo.
 */
export function typedNewlineLine(
  reason: number | undefined,
  changes: readonly TypedChangeLike[],
): number | undefined {
  if (reason !== undefined) return undefined;
  if (changes.length !== 1) return undefined;
  const change = changes[0];
  if (change === undefined) return undefined;
  if (change.rangeLength !== 0 || !BARE_NEWLINE.test(change.text)) {
    return undefined;
  }
  return change.range.start.line;
}
