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

  it('names the tabs block by its first panel label before any switch, and by the ACTIVE panel label after one', async () => {
    // Batch 11, item 4: the status line follows the active panel, not a
    // fixed first-panel identity. `reportActiveLabel` is called from
    // `tabs.tsx`'s key handler (an ordinary event-driven `setState`, not a
    // render-time report channel), so this is the mechanism, not a
    // guess about it.
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60);
    expect(view.lastFrame()).toContain('tabs "One"');
    await view.press('\t'); // switches the active tab; the tabs block is still the focused component
    expect(view.lastFrame()).toContain('tabs "Two"');
    expect(view.lastFrame()).not.toContain('tabs "One"');
    await view.press('\t'); // wraps back to the first panel
    expect(view.lastFrame()).toContain('tabs "One"');
    view.unmount();
  });

  it('falls back to the first panel label when the reader has not switched yet', async () => {
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 60);
    expect(view.lastFrame()).toContain('tabs "One"');
    view.unmount();
  });
});

describe('a tabs/details nested inside a card is focusable; nested inside a callout it is not', () => {
  it('the focus cycle over test-fixtures/tabs-details.mk.md visits the card-nested Alpha tabs and More details, never the callout-nested Gamma tabs or Buried details', async () => {
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
    // Batch 11 (Ink frames): `card` moved onto a real Ink `Box` border, so a
    // `tabs`/`details` nested in a card's body IS now a real focusable —
    // this fixture has four in document order: the top-level tabs, the
    // top-level details, `Holder`'s nested Alpha/Beta tabs, and `Folded`'s
    // nested More details. `callout` did NOT move (its per-line colored bar
    // has no Ink-native equivalent under the never-`borderColor` styling
    // rule — see `render.tsx`'s `CARD_NAME`/`FIGURE_NAME` doc comment), so
    // the fixture's trailing callout's nested Gamma tabs and Buried details
    // stay excluded from the cycle, the same boundary this test used to
    // assert for card before this batch.
    for (let i = 0; i < 8; i += 1) {
      const frame = view.lastFrame();
      const match = frame.match(/(tabs|details) "([^"]*)"/);
      expect(match).not.toBeNull();
      labels.add(`${match?.[1]} "${match?.[2]}"`);
      expect(frame).not.toMatch(/tabs "Gamma"/);
      expect(frame).not.toMatch(/details "Buried"/);
      await view.press('j');
    }
    expect(labels).toEqual(
      new Set([
        'tabs "One"',
        'details "Summary here"',
        'tabs "Alpha"',
        'details "More"',
      ]),
    );
    view.unmount();
  });
});

describe('card moved onto an Ink Box border (batch 11): its body keeps real focus', () => {
  it('enter toggles a details block nested directly inside a card', async () => {
    const doc =
      ':::::card{title="Holder"}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    expect(view.lastFrame()).toContain('▸');
    expect(view.lastFrame()).not.toContain('hidden body');
    await view.press('\r');
    expect(view.lastFrame()).toContain('▾');
    expect(view.lastFrame()).toContain('hidden body');
    view.unmount();
  });

  it('the card frame itself is drawn by Ink (a full border, byte-identical top/bottom width)', async () => {
    const doc = ':::card{title="Framed"}\nplain body\n:::\n';
    const view = await mountInteractive(doc, 40);
    // Interactive (live-loop) frames carry Ink's own cursor-hide escape
    // ahead of the content, unlike the render-once string path — strip
    // every escape sequence before matching the plain frame glyphs.
    const stripEscapes = (text: string): string =>
      text.replace(/\x1b\[[0-9?;]*[a-zA-Z]/g, '');
    const frame = stripEscapes(view.lastFrame());
    const lines = frame.split('\n').filter((l) => l.trim() !== '');
    expect(lines[0]).toMatch(/^┌.*Framed.*┐$/);
    expect(lines.some((line) => /^└─+┘$/.test(line))).toBe(true);
    view.unmount();
  });
});

describe('callout stayed STRING-mode (batch 11): its body has no real focus', () => {
  it('a details block nested inside a callout never becomes focusable (STRING mode always shows its body; no status line names it, and Enter does nothing)', async () => {
    const doc =
      ':::::callout{type=info}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    // The STRING-mode `Details` fallback (details-string.ts) has no
    // open/closed state at all — it always shows its body, exactly like
    // the pre-Ink engine's non-interactive render. The point under test is
    // that it never joins the focus cycle: no status line names it, and it
    // is unaffected by a keypress.
    expect(view.lastFrame()).toContain('nothing focusable');
    expect(view.lastFrame()).not.toContain('details "Nested"');
    const before = view.lastFrame();
    await view.press('\r');
    expect(view.lastFrame()).toBe(before);
    view.unmount();
  });
});

describe('figure gained ELEMENT-mode children (batch 11): a caption details block keeps real focus', () => {
  it('enter toggles a details block nested in a figure caption', async () => {
    const doc =
      ':::::figure{alt="x"}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    expect(view.lastFrame()).not.toContain('hidden body');
    await view.press('\r');
    expect(view.lastFrame()).toContain('hidden body');
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
