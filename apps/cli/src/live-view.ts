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
   * Builds the root element at a given column width. Called once at mount
   * and again on every terminal resize; `onExit` must be threaded down to
   * `buildMarkElement`'s own `onExit` option so the engine's `q` handler
   * reaches this module's unmount.
   */
  readonly buildElement: (width: number, onExit: () => void) => ReactElement;
}

/**
 * Mounts `options.buildElement`'s tree with Ink, re-rendering on terminal
 * resize so the width follows the window, and resolving once the mounted
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

  const instance = render(
    options.buildElement(options.initialWidth, handleExit),
    {
      stdout: options.stdout,
      stdin: options.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  instanceRef.current = instance;

  const onResize = (): void => {
    const width = options.stdout.columns ?? options.initialWidth;
    instance.rerender(options.buildElement(width, handleExit));
  };
  options.stdout.on('resize', onResize);

  try {
    await instance.waitUntilExit();
  } finally {
    options.stdout.off('resize', onResize);
  }
}
