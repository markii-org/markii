import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createEditorExtensions } from './codemirror-setup';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * A controlled CodeMirror 6 wrapper: React owns `value` as the document's
 * source of truth, but CodeMirror owns keystroke-level editing state (undo
 * history, selection, cursor) internally rather than being re-created on
 * every render. Local edits flow up via `onChange` on every doc change;
 * `value` only flows back down to sync an *external* change to the text
 * (there isn't one yet in this app beyond the initial mount, but this keeps
 * the component honestly "controlled" rather than accidentally uncontrolled).
 */
export function CodeEditor({
  value,
  onChange,
  className,
}: CodeEditorProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: createEditorExtensions((text) => {
          onChangeRef.current(text);
        }),
      }),
      parent: container,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally only re-runs on mount: the editor instance owns its own
    // document/selection state after creation; `value` is synced separately
    // below rather than by tearing the editor down on every keystroke.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={containerRef} className={className} />;
}
