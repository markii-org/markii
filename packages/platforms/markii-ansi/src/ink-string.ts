import { Writable } from 'node:stream';
import type { ReactElement } from 'react';

/**
 * The ONE place Ink's `render()` is called for the render-ONCE (string)
 * path. Reuses exactly the mechanism batch 10's phase-1 spike proved
 * (`spike/item1-render-once.mjs`, `SPIKE-10-findings.md`'s "Item 1"): mount
 * against a `Writable` that never touches a real TTY, reports the requested
 * `columns`, collect every chunk written to it, unmount immediately after
 * `render()` returns (no further ticks are needed for the collecting-stream
 * setup the spike used), and join the chunks.
 *
 * `interactive: false` in the render OPTIONS below is Ink's own render
 * option, and it is load-bearing: without it Ink 7 unconditionally emits
 * cursor hide/show (`CSI ?25l`/`CSI ?25h`) and synchronized-update markers
 * (`CSI ?2026h`/`CSI ?2026l`) whenever `stdout.isTTY` is true, which is
 * exactly the escape noise a static render must never produce.
 *
 * NAME COLLISION, documented per the batch-10 brief: this is a DIFFERENT
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
 * top-level `await` at ES-module-evaluation time (`SPIKE-10-findings.md`'s
 * "Item 3"): the first call to this function pays that one-time cost, and
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
