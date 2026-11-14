/**
 * Mounts a live Ink app for `markii view`'s interactive path. This module
 * never reads `process` itself: `main.ts` is the only caller, and it is the
 * one that passes real `process.stdout`/`process.stdin` in — everything
 * here takes what it needs as plain arguments, per this app's rule that
 * only `main.ts`/`terminal.ts` touch the process directly.
 *
 * `ink` is imported dynamically for the same reason `@markii/ansi`'s own
 * `ink-string.ts` does: `yoga-layout` resolves its WASM module via a
 * top-level `await`, so the first call anywhere in the process pays that
 * one-time cost.
 */
import type { ReactElement } from 'react';

export interface LiveViewerOptions {
  readonly stdout: NodeJS.WriteStream;
  readonly stdin: NodeJS.ReadStream;
  /** The column width to render at on first mount. */
  readonly initialWidth: number;
  /**
   * Builds the root element at a given column width and row count. Called
   * once at mount and again on every terminal resize; `onExit` must be
   * threaded down to `buildMarkElement`'s own `onExit` option so the
   * engine's `q` handler reaches this module's unmount, and `rows` (when
   * the terminal reports one) to its `viewportRows` option so the document
   * scrolls inside the window with the status line pinned.
   */
  readonly buildElement: (
    width: number,
    onExit: () => void,
    rows: number | undefined,
    onRerun: (() => Promise<void>) | undefined,
  ) => ReactElement;
  /**
   * `r`: runs the note's scripts again and resolves when the new values are
   * in the store. The viewer redraws once it settles, so `buildElement`
   * receives a callback that already does that. Absent, the key is not offered.
   */
  readonly rerun?: () => Promise<void>;
  /**
   * `--watch`: registers `refresh`, which re-renders the tree at the
   * current width; returns a function that unregisters it. A re-render,
   * not a remount, so the engine keeps its focus and open state.
   */
  readonly subscribe?: (refresh: () => void) => () => void;
}

/**
 * Mounts `options.buildElement`'s tree with Ink, re-rendering on terminal
 * resize so the width and the viewport height follow the window, and resolving once the mounted
 * tree calls its own `onExit` (the engine's `q` handler) or Ink's instance
 * otherwise exits. Never rejects: the caller can always flush its held
 * diagnostics afterward regardless of how the view ended.
 */
export async function runLiveViewer(options: LiveViewerOptions): Promise<void> {
  const { render } = await import('ink');
  type Instance = ReturnType<typeof render>;
  // A mutable ref object rather than a `let`: `handleExit` needs to call
  // `unmount()` on an instance that does not exist until after `render()`
  // returns, and `render()` itself must build a tree whose `onExit` prop is
  // already wired to `handleExit`.
  const instanceRef: { current?: Instance } = {};

  const handleExit = (): void => {
    instanceRef.current?.unmount();
  };

  // One row is held back: when Ink's output is as tall as the terminal it
  // clears the whole screen on every frame, which flickers.
  const currentRows = (): number | undefined => {
    const rows = options.stdout.rows;
    return rows !== undefined && rows > 1 ? rows - 1 : undefined;
  };

  // The engine passes this to its `r` key. The redraw is a re-render, not a
  // remount, so focus and open state survive it. A run that throws still
  // redraws and never rejects into the engine.
  const handleRerun =
    options.rerun === undefined
      ? undefined
      : async (): Promise<void> => {
          try {
            await options.rerun?.();
          } catch {
            // The host reports its own failures.
          }
          instanceRef.current?.rerender(build(width));
        };
  const build = (columns: number): ReactElement =>
    options.buildElement(columns, handleExit, currentRows(), handleRerun);

  let width = options.initialWidth;
  const instance = render(build(width), {
    stdout: options.stdout,
    stdin: options.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  instanceRef.current = instance;

  const onResize = (): void => {
    width = options.stdout.columns ?? options.initialWidth;
    instance.rerender(build(width));
  };
  options.stdout.on('resize', onResize);
  const unsubscribe = options.subscribe?.(() => {
    instance.rerender(build(width));
  });

  try {
    await instance.waitUntilExit();
  } finally {
    options.stdout.off('resize', onResize);
    unsubscribe?.();
  }
}
