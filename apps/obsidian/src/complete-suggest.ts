import { EditorSuggest } from 'obsidian';
import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from 'obsidian';
import { offsetToLineColumn } from '@markii/stdlib/editor';
import { MARK_EXTENSION, isContainerCompletionItem } from '@markii/host';
import type { HostTextEdit, MarkiiHost } from '@markii/host';
import {
  completionQuery,
  completionSuggestions,
  filterCompletionSuggestions,
} from './complete-component.js';
import type { CompletionSuggestion } from './complete-component.js';

/**
 * Imports `obsidian` — added deliberately to
 * `src/obsidian-import-guard.test.ts`'s allowlist alongside
 * `main.ts`/`view.tsx`/`settings-tab.ts`/`run-modals.ts`/`insert-modals.ts`.
 * A real `EditorSuggest` subclass cannot exist without importing `obsidian`,
 * and is untestable regardless of which file it lives in — kept separate
 * from `main.ts` for the same reason `insert-modals.ts` is. Every piece
 * worth testing in isolation (the row shape, the query slice, the filter,
 * the wording) already lives in `./complete-component.ts`.
 */

/** The current context's replacement range plus the query it was built with, stashed by `onTrigger` for `getSuggestions`/`selectSuggestion`. */
interface StashedContext {
  readonly rows: readonly CompletionSuggestion[];
  /** Fence rewrites that travel with an accepted container item, computed by the host for the document as it stood at trigger time. */
  readonly fenceEdits: readonly HostTextEdit[];
}

/**
 * Directive autocompletion (GitHub issue #27, slice 3): offers directive
 * names, attribute names, and enum attribute values as the author types,
 * built on `@markii/host`'s `completeAtSync` (the shared host decides what
 * completes, the replace span, and the fence edits; this class only maps
 * the outcome onto Obsidian's popup).
 *
 * The host is a GETTER, not a snapshot, so `main.ts` can swap or refresh
 * it after pack settings change without tearing down and re-registering
 * the suggester.
 */
export class MarkiiCompletionSuggest extends EditorSuggest<CompletionSuggestion> {
  private readonly host: () => MarkiiHost;
  private stashed: StashedContext | undefined;

  constructor(app: App, host: () => MarkiiHost) {
    super(app);
    this.host = host;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!file?.path.endsWith(MARK_EXTENSION)) return null;

    const line = editor.getLine(cursor.line);

    // The host answers `none` for a bare colon run that CLOSES a container
    // already open above it (GitHub issue #57), and for any context with
    // nothing to offer, so this trigger boundary has no fence scan of its
    // own.
    const outcome = this.host().completeAtSync({
      line: cursor.line,
      column: cursor.ch,
      documentText: editor.getValue(),
    });
    if (outcome.kind !== 'completions') return null;

    this.stashed = {
      rows: completionSuggestions(outcome.items),
      fenceEdits: outcome.fenceEdits,
    };

    return {
      start: { line: cursor.line, ch: outcome.replaceStart },
      end: { line: cursor.line, ch: outcome.replaceEnd },
      query: completionQuery(line, outcome.tokenStart, cursor.ch),
    };
  }

  getSuggestions(context: EditorSuggestContext): CompletionSuggestion[] {
    const rows = this.stashed?.rows ?? [];
    return [...filterCompletionSuggestions(rows, context.query)];
  }

  renderSuggestion(suggestion: CompletionSuggestion, el: HTMLElement): void {
    // Matches `./insert-modals.ts`'s `renderSuggestion` exactly: separate
    // elements rather than one joined string, `small` for the
    // already-de-emphasized secondary lines, and no element at all when a
    // line has nothing to show.
    el.createDiv({ text: suggestion.label });
    if (suggestion.origin.length > 0) {
      el.createEl('small', { text: suggestion.origin });
    }
    if (suggestion.detail.length > 0) {
      el.createEl('small', { text: suggestion.detail });
    }
  }

  selectSuggestion(
    suggestion: CompletionSuggestion,
    _evt: MouseEvent | KeyboardEvent,
  ): void {
    const context = this.context;
    if (!context) return;

    const { item } = suggestion;

    // Fence auto-extension: accepting a CONTAINER item inside an existing
    // container needs the enclosing pair to carry more colons. The fence
    // changes go into the SAME transaction as the accepted text, so the
    // whole acceptance is one undo step, and they never touch the line
    // being replaced. A non-container item, or a document whose fences do
    // not pair cleanly, has none and this stays a plain range replace.
    const fenceChanges = isContainerCompletionItem(item)
      ? (this.stashed?.fenceEdits ?? [])
      : [];

    if (fenceChanges.length === 0) {
      context.editor.replaceRange(item.insertText, context.start, context.end);
    } else {
      context.editor.transaction({
        changes: [
          ...fenceChanges.map((change) => ({
            from: { line: change.line, ch: change.startColumn },
            to: { line: change.line, ch: change.endColumn },
            text: change.text,
          })),
          { from: context.start, to: context.end, text: item.insertText },
        ],
      });
    }

    const cursor = offsetToLineColumn(item.insertText, item.insertCursorOffset);
    const cursorPosition =
      cursor.line === 0
        ? { line: context.start.line, ch: context.start.ch + cursor.column }
        : { line: context.start.line + cursor.line, ch: cursor.column };
    context.editor.setCursor(cursorPosition);

    this.close();
  }
}
