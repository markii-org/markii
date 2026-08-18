import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';

/**
 * Syntax colors for the `.mk.md` source pane, tuned to sit next to the
 * rendered preview without clashing: headings/emphasis in the document's
 * ink color, links/URLs in the same blue the `callout{type=info}` accent
 * uses (`doc.css`), markup punctuation (`**`, `` ` ``, `#`, list markers)
 * dimmed the way it visually recedes in the rendered output.
 */
const smdHighlightStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2], fontWeight: '700', color: '#1a1a1a' },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: '600',
    color: '#1a1a1a',
  },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.quote, color: '#666666' },
  { tag: tags.list, color: '#1a1a1a' },
  { tag: [tags.link, tags.url], color: '#3b82f6' },
  { tag: tags.monospace, color: '#a03e8f' },
  { tag: tags.labelName, color: '#7c3aed' },
  { tag: tags.string, color: '#0f766e' },
  { tag: tags.escape, color: '#666666' },
  { tag: tags.character, color: '#666666' },
  { tag: tags.processingInstruction, color: '#94a3b8' },
  { tag: tags.contentSeparator, color: '#94a3b8' },
  { tag: tags.comment, color: '#888888', fontStyle: 'italic' },
]);

/** Minimal `.mk.md`-editor look, matching `styles.css`'s palette and type scale. */
const smdEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.9rem',
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  '.cm-content': {
    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, monospace",
    lineHeight: '1.5',
    padding: '1rem',
    caretColor: '#1a1a1a',
  },
  '.cm-gutters': {
    backgroundColor: '#ffffff',
    color: '#c1c4ca',
    border: 'none',
  },
  /*
   * No `.cm-activeLine` rule: the active-line highlight is off (see
   * `createEditorExtensions`). The gutter cue stays, but as a color change
   * only — a tinted block in the gutter with no matching tint across the line
   * would read as a stray artifact, whereas a darkened line number is a quiet
   * "you are here" that never touches the text area.
   */
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#888888',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#dbe9ff !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
});

/**
 * The playground editor's full extension set: markdown syntax highlighting
 * (`@codemirror/lang-markdown`), line wrapping, and a small hand-picked set
 * of editing conveniences (history/undo, bracket matching, gutter cue for the
 * caret's line). Deliberately excludes autocomplete and linting — out of scope
 * per docs/integration.md (no directive-aware language server, "maybe never").
 *
 * `highlightActiveLine` is deliberately absent: it paints its background on
 * the `.cm-line` element, which sits ABOVE `drawSelection`'s selection layer,
 * so the active line's tint covered the selection highlight on whichever line
 * the caret was on. `highlightActiveLineGutter` is kept — it lives in the
 * gutter, can never overlap a selection, and (restyled to a color-only cue in
 * `smdEditorTheme`) preserves the "which line am I on" signal that removing
 * the line background would otherwise cost.
 */
export function createEditorExtensions(
  onDocChange: (text: string) => void,
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(smdHighlightStyle),
    markdown(),
    EditorView.lineWrapping,
    smdEditorTheme,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onDocChange(update.state.doc.toString());
      }
    }),
  ];
}
