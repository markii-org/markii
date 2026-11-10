import { Writable } from 'node:stream';
import type { ReactElement } from 'react';
import { render as inkRender } from 'ink';

/**
 * The ONE place Ink's `render()` is called for the render-ONCE (string)
 * path. It mounts against a `Writable` that never touches a real TTY and
 * reports the requested `columns`, collects every chunk written to it,
 * unmounts immediately after `render()` returns, and joins the chunks.
 *
 * `interactive: false` in the render OPTIONS below is Ink's own render
 * option, and it is load-bearing: without it Ink 7 unconditionally emits
 * cursor hide/show (`CSI ?25l`/`CSI ?25h`) and synchronized-update markers
 * (`CSI ?2026h`/`CSI ?2026l`) whenever `stdout.isTTY` is true, which is
 * exactly the escape noise a static render must never produce.
 *
 * NAME COLLISION: this is a DIFFERENT
 * `interactive` from the `interactive` flag on this engine's own render
 * CONTEXT (`registry.ts`'s `AnsiRenderContext.interactive`, documented at
 * its own declaration). Ink's flag controls which ESCAPE SEQUENCES Ink
 * itself emits around a frame; this engine's own flag controls which
 * CONTENT a component renders (the active tab only, a closed details block).
 * They are set independently: `renderInkToString` below always renders with
 * Ink's `interactive: false` (a single captured frame, no TTY control
 * sequences), whether or not the tree it is capturing was built with this
 * engine's `ctx.interactive` true or false.
 */

interface CollectingStream {
  stream: Writable;
  getOutput: () => string;
}

function makeCollectingStream(columns: number): CollectingStream {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  }) as Writable & {
    columns: number;
    rows: number;
    isTTY: boolean;
    getColorDepth: () => number;
    hasColors: () => boolean;
  };
  stream.columns = columns;
  stream.rows = 40;
  // Ink's static/measured layout paths expect a TTY-shaped stream.
  stream.isTTY = true;
  stream.getColorDepth = () => 8;
  stream.hasColors = () => true;
  return { stream, getOutput: () => chunks.join('') };
}

/**
 * Mounts `element` with Ink at `columns` wide, captures the first (and only)
 * frame as a plain string, and unmounts. `ink` is imported dynamically
 * because `yoga-layout` (Ink's layout engine) resolves its WASM module via a
 * top-level `await` at ES-module-evaluation time: the first call to this function pays that one-time cost, and
 * every exported entry point that reaches here is therefore `async`. A
 * later call in the same process reuses the already-evaluated module graph,
 * the ordinary ESM module-cache guarantee.
 */
export async function renderInkToString(
  element: ReactElement,
  columns: number,
): Promise<string> {
  const { render } = await import('ink');
  const { stream, getOutput } = makeCollectingStream(columns);
  const instance = render(element, {
    stdout: stream as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: false,
    interactive: false,
  });
  instance.unmount();
  return getOutput();
}

/**
 * The same capture as `renderInkToString`, synchronously. Valid only once
 * Ink's module has finished evaluating, which is always true inside a walk
 * (`render.tsx` imports Ink statically). Used for a registry component that
 * returns an Ink element instead of a string (a terminal pack's view): the
 * element is laid out at the width the directive was given and captured as
 * text, so it composes with the string-built blocks around it. The result
 * is a snapshot, so a component rendered this way has no live state.
 * Trailing newlines Ink adds are removed.
 */
export function renderInkToStringSync(
  element: ReactElement,
  columns: number,
): string {
  const { stream, getOutput } = makeCollectingStream(columns);
  const instance = inkRender(element, {
    stdout: stream as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: false,
    interactive: false,
  });
  instance.unmount();
  return getOutput().replace(/\n+$/, '');
}
