/**
 * A tiny per-document pub/sub for "this note's persisted values changed",
 * so the Reading view (`../reading-view.ts`) can re-render after a Run
 * without polling `localStorage` on every note and without depending on
 * Obsidian's typed `Workspace` events, which only cover Obsidian's own
 * built-in event names.
 *
 * `view.tsx`'s `MarkiiPreviewView.runScripts` calls `emitValuesChanged`
 * once a run's values are applied (both the streaming `onValue` callback
 * and the completed-run path); the Reading view section for the same note
 * path re-renders from its own `readPersistedValues` read, exactly the way
 * `MarkiiPreviewView.refresh()` already does. Deliberately `obsidian`-free
 * (this plugin's file-scope split, `src/obsidian-import-guard.test.ts`), so
 * it can be unit-tested with a plain in-memory harness.
 */

export type ValuesChangedListener = (documentPath: string) => void;

const listeners = new Map<string, Set<ValuesChangedListener>>();

/**
 * Subscribes to value changes for one document path. Returns an
 * unsubscribe function; calling it twice is a harmless no-op.
 */
export function onValuesChanged(
  documentPath: string,
  listener: ValuesChangedListener,
): () => void {
  let set = listeners.get(documentPath);
  if (!set) {
    set = new Set();
    listeners.set(documentPath, set);
  }
  set.add(listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(documentPath);
  };
}

/**
 * Tells every listener registered for `documentPath` that its persisted
 * values changed. A listener that throws is reported to the console and
 * skipped rather than breaking the run that triggered it: a re-render
 * failing in one Reading view section must never surface as a failed Run.
 */
export function emitValuesChanged(documentPath: string): void {
  const set = listeners.get(documentPath);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(documentPath);
    } catch (error) {
      console.error(
        `[markii] a values-changed listener for "${documentPath}" threw`,
        error,
      );
    }
  }
}
