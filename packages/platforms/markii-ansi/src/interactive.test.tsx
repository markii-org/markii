import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildMarkElement } from './render.js';
import { defaultAnsiTheme } from './theme.js';
import type { ColorOption } from './ansi.js';

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

async function mountInteractive(
  source: string,
  width = 40,
  color: ColorOption = 'never',
) {
  const { render } = await import('ink');
  const stdin = makeFakeStdin();
  const { stream: stdout, lastFrame } = makeCollectingStdout(width);
  const element = buildMarkElement(source, undefined, {
    width,
    color,
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

/**
 * Batch 10.1: focus was silently invisible (`useFocusMarker` had no call
 * site). These tests mount at color level '256' (the level `FORCE_COLOR=2`
 * resolves to, per the batch's repro) and assert the accent SGR is present
 * around the focused heading, moves with focus, and that a glyph marks
 * focus too so a theme with no perceptible accent still shows it.
 */
const accentColor = defaultAnsiTheme['--mk-accent'];
if (!accentColor) throw new Error('theme has no --mk-accent color');
const ACCENT_OPEN = `\x1b[38;5;${accentColor.ansi256}m`;

const TABS_AND_DETAILS_DOC =
  '::::tabs\n:::tab{label="One"}\nOne body\n:::\n:::tab{label="Two"}\nTwo body\n:::\n::::\n\n:::details{title="More"}\nDetails body\n:::\n';

describe('focus is visible', () => {
  it('the focused tabs heading carries the accent color and the › glyph', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60, '256');
    const frame = view.lastFrame();
    const index = frame.indexOf(ACCENT_OPEN);
    expect(index).toBeGreaterThanOrEqual(0);
    const window = frame.slice(index, index + 80);
    expect(window).toContain('›');
    expect(window).toContain('One');
    // Only one block is focused at a time.
    expect(frame.split(ACCENT_OPEN).length - 1).toBe(1);
    view.unmount();
  });

  it('moving focus with j moves the accent and glyph to the details block', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60, '256');
    await view.press('j');
    const frame = view.lastFrame();
    const index = frame.indexOf(ACCENT_OPEN);
    expect(index).toBeGreaterThanOrEqual(0);
    const window = frame.slice(index, index + 80);
    expect(window).toContain('›');
    expect(window).toContain('More');
    expect(frame.split(ACCENT_OPEN).length - 1).toBe(1);
    view.unmount();
  });

  it('down arrow moves the accent the same way j does', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60, '256');
    await view.press('\x1b[B');
    const frame = view.lastFrame();
    const index = frame.indexOf(ACCENT_OPEN);
    expect(frame.slice(index, index + 80)).toContain('More');
    view.unmount();
  });

  it('an unfocused heading gets two leading spaces instead of the glyph, so nothing shifts', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60, '256');
    const frame = view.lastFrame();
    // The unfocused details heading: no accent, two leading spaces, then (after its own dim styling) the glyph/title.
    expect(frame).toMatch(/\n {2}(?:\x1b\[[0-9;]*m)*[▾▸] /);
    view.unmount();
  });
});

describe('live wording: the enter hint on a focused details block', () => {
  it('shows "enter to open" when focused and closed', async () => {
    const view = await mountInteractive(DETAILS_DOC);
    const frame = view.lastFrame();
    expect(frame).toContain('enter to open');
    expect(frame).not.toContain('enter to close');
    view.unmount();
  });

  it('shows "enter to close" once opened', async () => {
    const view = await mountInteractive(DETAILS_DOC);
    await view.press('\r');
    const frame = view.lastFrame();
    expect(frame).toContain('enter to close');
    expect(frame).not.toContain('enter to open');
    view.unmount();
  });

  it('an unfocused details block carries no hint', async () => {
    const doc =
      ':::details{title="A"}\nbody A\n:::\n\n:::details{title="B"}\nbody B\n:::\n';
    const view = await mountInteractive(doc);
    const frame = view.lastFrame();
    // Only "A" (focusId 0, the default focus) gets a hint; "B" gets none.
    expect((frame.match(/enter to open/g) ?? []).length).toBe(1);
    view.unmount();
  });
});

describe('the status line', () => {
  it('names the focused tabs block by its first panel label, and shows the key legend', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60);
    const frame = view.lastFrame();
    expect(frame).toContain('tabs "One"');
    expect(frame).toContain('↑↓/jk focus');
    expect(frame).toContain('←→/tab switch');
    expect(frame).toContain('enter open/close');
    expect(frame).toContain('quit');
    view.unmount();
  });

  it('names the focused details block by its title after moving focus', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60);
    await view.press('j');
    const frame = view.lastFrame();
    expect(frame).toContain('details "More"');
    view.unmount();
  });

  it('reads "nothing focusable" when the document has no tabs or details', async () => {
    const view = await mountInteractive('Just a paragraph.\n', 60);
    const frame = view.lastFrame();
    expect(frame).toContain('nothing focusable');
    view.unmount();
  });

  it('keeps naming the tabs block by its first panel label after switching the active tab', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60);
    await view.press('\t'); // switches the active tab; the tabs block is still the focused component
    const frame = view.lastFrame();
    expect(frame).toContain('tabs "One"');
    view.unmount();
  });
});

describe('blocks nested inside a framed component are not focusable', () => {
  it('the focus cycle over test-fixtures/tabs-details.mk.md has exactly two stops, never the nested Alpha tabs or nested details', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const source = readFileSync(
      join(here, '..', 'test-fixtures', 'tabs-details.mk.md'),
      'utf8',
    );
    const view = await mountInteractive(source, 80);
    const labels = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const frame = view.lastFrame();
      const match = frame.match(/(tabs|details) "([^"]*)"/);
      expect(match).not.toBeNull();
      labels.add(`${match?.[1]} "${match?.[2]}"`);
      expect(frame).not.toMatch(/tabs "Alpha"/);
      expect(frame).not.toMatch(/details "More"/);
      await view.press('j');
    }
    expect(labels.size).toBe(2);
    view.unmount();
  });
});

describe('the static path never leaks live-mode wording', () => {
  it('a string render of test-fixtures/tabs-details.mk.md carries no status line, legend, or focus glyph', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { renderMarkToAnsi } = await import('./render.js');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const source = readFileSync(
      join(here, '..', 'test-fixtures', 'tabs-details.mk.md'),
      'utf8',
    );
    const rendered = await renderMarkToAnsi(
      source,
      undefined,
      undefined,
      undefined,
      { width: 80, color: 'never' },
    );
    expect(rendered).not.toContain('↑↓/jk focus');
    expect(rendered).not.toContain('nothing focusable');
    expect(rendered).not.toContain('›');
    expect(rendered).not.toContain('enter to open');
    expect(rendered).not.toContain('enter to close');
  });
});
