import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildMarkElement } from './render.js';

/**
 * Interactive-mode tests, feeding real keys through Ink's own input pipeline
 * (a fake stdin, the same collecting-stdout pattern phase 1's spike proved
 * for the render-once path) and asserting the next captured frame — the
 * brief's "every interactive behavior gets a test that feeds keys through
 * Ink's testing pattern and asserts the next frame."
 *
 * Unlike `ink-string.ts` (always `interactive: false`, unmounted after one
 * frame), these tests mount with Ink's default interactive render loop,
 * since a one-shot render can never receive a keypress.
 */

function makeFakeStdin() {
  const stream = new Readable({
    read() {
      /* fed manually via press() below */
    },
  }) as Readable & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    setEncoding: (encoding: string) => void;
    ref: () => void;
    unref: () => void;
  };
  stream.isTTY = true;
  stream.setRawMode = () => {};
  stream.ref = () => {};
  stream.unref = () => {};
  const originalSetEncoding = stream.setEncoding.bind(stream);
  stream.setEncoding = (encoding: string) => {
    originalSetEncoding(encoding);
    return stream;
  };
  return stream;
}

function makeCollectingStdout(columns: number) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
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
  stream.isTTY = true;
  stream.getColorDepth = () => 8;
  stream.hasColors = () => true;
  // Ink's interactive mode wraps each frame in a synchronized-update pair
  // (`CSI ?2026h` ... frame ... `CSI ?2026l`), written as more than one
  // `write()` call. The most recent complete frame is everything after the
  // LAST begin-sync marker in the accumulated output (or the whole buffer,
  // for the very first frame, which carries no marker at all in this
  // engine's fake, cursor-less terminal).
  const lastFrame = (): string => {
    const all = chunks.join('');
    const marker = '\x1b[?2026h';
    const index = all.lastIndexOf(marker);
    return index === -1 ? all : all.slice(index + marker.length);
  };
  return { stream, lastFrame };
}

/** A tiny delay to let Ink's async re-render settle after a keypress, without depending on Ink's own internal scheduling details. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

async function mountInteractive(source: string, width = 40) {
  const { render } = await import('ink');
  const stdin = makeFakeStdin();
  const { stream: stdout, lastFrame } = makeCollectingStdout(width);
  const element = buildMarkElement(source, undefined, {
    width,
    color: 'never',
    interactive: true,
  });
  const instance = render(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: false,
    interactive: true,
  });
  await tick();
  const press = async (data: string) => {
    stdin.push(Buffer.from(data, 'utf8'));
    await tick();
  };
  return {
    press,
    lastFrame,
    unmount: () => instance.unmount(),
  };
}

const TABS_DOC =
  '::::tabs\n:::tab{label="Overview"}\nOverview body\n:::\n:::tab{label="Settings"}\nSettings body\n:::\n::::\n';

const DETAILS_DOC = ':::details{title="More"}\nhidden body\n:::\n';

describe('interactive tabs', () => {
  it('shows only the active panel, starting with the first', async () => {
    const view = await mountInteractive(TABS_DOC);
    const frame = view.lastFrame();
    expect(frame).toContain('Overview body');
    expect(frame).not.toContain('Settings body');
    view.unmount();
  });

  it('right arrow / Tab switches to the next panel', async () => {
    const view = await mountInteractive(TABS_DOC);
    await view.press('\t');
    const frame = view.lastFrame();
    expect(frame).toContain('Settings body');
    expect(frame).not.toContain('Overview body');
    view.unmount();
  });

  it('left arrow switches back to the previous panel', async () => {
    const view = await mountInteractive(TABS_DOC);
    await view.press('[C'); // right
    await view.press('[D'); // left
    const frame = view.lastFrame();
    expect(frame).toContain('Overview body');
    view.unmount();
  });
});

describe('interactive details', () => {
  it('starts closed with no `open` attribute', async () => {
    const view = await mountInteractive(DETAILS_DOC);
    const frame = view.lastFrame();
    expect(frame).not.toContain('hidden body');
    view.unmount();
  });

  it('Enter toggles it open, and again closed', async () => {
    const view = await mountInteractive(DETAILS_DOC);
    await view.press('\r');
    expect(view.lastFrame()).toContain('hidden body');
    await view.press('\r');
    expect(view.lastFrame()).not.toContain('hidden body');
    view.unmount();
  });
});

describe('quit and focus movement own no process state', () => {
  it('q calls the supplied onExit handler rather than touching process', async () => {
    const { render } = await import('ink');
    const stdin = makeFakeStdin();
    const { stream: stdout } = makeCollectingStdout(40);
    let exited = false;
    const element = buildMarkElement(TABS_DOC, undefined, {
      width: 40,
      color: 'never',
      interactive: true,
      onExit: () => {
        exited = true;
      },
    });
    const instance = render(element, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
      debug: false,
      interactive: true,
    });
    await tick();
    stdin.push(Buffer.from('q', 'utf8'));
    await tick();
    expect(exited).toBe(true);
    instance.unmount();
  });

  it('j/k move focus between two details blocks (second opens independently of the first)', async () => {
    const doc =
      ':::details{title="A"}\nbody A\n:::\n\n:::details{title="B"}\nbody B\n:::\n';
    const view = await mountInteractive(doc);
    await view.press('j'); // move focus to the second details block
    await view.press('\r'); // open it
    const frame = view.lastFrame();
    expect(frame).toContain('body B');
    expect(frame).not.toContain('body A');
    view.unmount();
  });

  it('down arrow / up arrow move focus the same way j/k do', async () => {
    const doc =
      ':::details{title="A"}\nbody A\n:::\n\n:::details{title="B"}\nbody B\n:::\n';
    const view = await mountInteractive(doc);
    await view.press('\x1b[B'); // down arrow: focus the second block
    await view.press('\r'); // open it
    expect(view.lastFrame()).toContain('body B');
    await view.press('\r'); // close it again before moving focus back
    await view.press('\x1b[A'); // up arrow: focus back to the first block
    await view.press('\r'); // open it
    const frame = view.lastFrame();
    expect(frame).toContain('body A');
    expect(frame).not.toContain('body B');
    view.unmount();
  });
});
