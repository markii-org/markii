import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildMarkElement } from './render.js';
import { defaultAnsiTheme } from './theme.js';
import type { ColorOption } from './ansi.js';
import type { BoxStyle } from './glyphs.js';

/**
 * Interactive-mode tests, feeding real keys through Ink's own input pipeline
 * (a fake stdin and a collecting stdout, as the render-once path uses)
 * and asserting the next captured frame. Every interactive behavior gets a
 * test that feeds keys through Ink and asserts the next frame.
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
  box: BoxStyle = 'unicode',
  viewportRows?: number,
  onRerun?: () => void | Promise<void>,
) {
  const { render } = await import('ink');
  const stdin = makeFakeStdin();
  const { stream: stdout, lastFrame } = makeCollectingStdout(width);
  const element = buildMarkElement(source, undefined, {
    width,
    color,
    box,
    interactive: true,
    ...(viewportRows !== undefined ? { viewportRows } : {}),
    ...(onRerun !== undefined ? { onRerun } : {}),
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

describe("box: 'ascii' in the live viewer", () => {
  it('draws the focus marker, fold markers, and status line in 7-bit characters', async () => {
    const view = await mountInteractive(
      `${TABS_DOC}\n${DETAILS_DOC}`,
      110,
      'never',
      'ascii',
    );
    await view.press('j');
    await view.press('\r');
    const frame = view.lastFrame();
    expect(frame).toContain('> - More');
    expect(frame).toContain('left/right/tab switch');
    expect([...frame].filter((ch) => ch.charCodeAt(0) > 0x7f)).toEqual([]);
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
 * Focus must be visible. These tests mount at color level '256' (the level `FORCE_COLOR=2`
 * resolves to, ) and assert the accent SGR is present
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
    const view = await mountInteractive(TABS_AND_DETAILS_DOC, 110);
    const frame = view.lastFrame();
    expect(frame).toContain('tabs "One"');
    expect(frame).toContain('↑↓/jk focus');
    expect(frame).toContain('space/pgdn scroll');
    expect(frame).toContain('g/G top/end');
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

describe('a tabs/details nested inside a card is focusable; so is one nested inside a callout', () => {
  it('the focus cycle over test-fixtures/tabs-details.mk.md visits every tabs and details, including the ones nested in a card and in a callout', async () => {
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
    // Six focusables in document order: the top-level tabs and details,
    // Holder's Alpha/Beta tabs, Folded's More details, and the callout's
    // Gamma/Delta tabs and Buried details.
    for (let i = 0; i < 12; i += 1) {
      const frame = view.lastFrame();
      const match = frame.match(/(tabs|details) "([^"]*)"/);
      expect(match).not.toBeNull();
      labels.add(`${match?.[1]} "${match?.[2]}"`);
      await view.press('j');
    }
    expect(labels).toEqual(
      new Set([
        'tabs "One"',
        'details "Summary here"',
        'tabs "Alpha"',
        'details "More"',
        'tabs "Gamma"',
        'details "Buried"',
      ]),
    );
    view.unmount();
  });
});

describe('card moved onto an Ink Box border: its body keeps real focus', () => {
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

describe('callout is an Ink subtree: its body keeps real focus and its bar', () => {
  const stripEscapes = (text: string): string =>
    text.replace(/\x1b\[[0-9?;]*[a-zA-Z]/g, '');

  it('enter toggles a details block nested inside a callout, and every body line keeps the bar', async () => {
    const doc =
      ':::::callout{type=info title="Aside"}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    expect(view.lastFrame()).toContain('details "Nested"');
    expect(view.lastFrame()).not.toContain('hidden body');
    await view.press('\r');
    const frame = stripEscapes(view.lastFrame());
    expect(frame).toContain('hidden body');
    const lines = frame
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(0, -1); // the status line
    const body = lines.filter((line) => /Info|Aside|Nested|hidden/.test(line));
    expect(body.length).toBeGreaterThanOrEqual(4);
    for (const line of body) expect(line.startsWith('▌')).toBe(true);
    view.unmount();
  });

  it('switches a tabs block nested inside a callout', async () => {
    const doc =
      ':::::callout{type=warning}\n::::tabs\n:::tab{label="A"}\nbody a\n:::\n:::tab{label="B"}\nbody b\n:::\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    expect(view.lastFrame()).toContain('body a');
    await view.press('\t');
    expect(view.lastFrame()).toContain('body b');
    expect(view.lastFrame()).toContain('tabs "B"');
    view.unmount();
  });

  it('draws the bar in the type color through the border glyph at truecolor', async () => {
    const view = await mountInteractive(
      ':::callout{type=danger}\nbody\n:::\n',
      40,
      'truecolor',
    );
    expect(view.lastFrame()).toMatch(/\x1b\[38;2;\d+;\d+;\d+m▌/);
    view.unmount();
  });

  it('a centered callout keeps a nested details focusable', async () => {
    const doc =
      ':::::callout{text=center}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    await view.press('\r');
    expect(view.lastFrame()).toContain('hidden body');
    view.unmount();
  });

  it('a centered card keeps a nested details focusable', async () => {
    const doc =
      ':::::card{text=center}\n::::details{title="Nested"}\nhidden body\n::::\n:::::\n';
    const view = await mountInteractive(doc, 60);
    await view.press('\r');
    expect(view.lastFrame()).toContain('hidden body');
    view.unmount();
  });
});

describe('figure gained ELEMENT-mode children: a caption details block keeps real focus', () => {
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

function manyLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n\n');
}

function visibleLines(frame: string): string[] {
  return frame
    .replace(/\x1b\[[0-9?;]*[a-zA-Z]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

describe('the viewport (viewportRows)', () => {
  it('shows only the first rows-1 rows of a long document, with the status line last', async () => {
    const view = await mountInteractive(
      manyLines(30),
      60,
      'never',
      'unicode',
      10,
    );
    const lines = visibleLines(view.lastFrame());
    expect(lines[0]).toBe('line 1');
    expect(lines).not.toContain('line 30');
    expect(lines[lines.length - 1]).toContain('nothing focusable');
    view.unmount();
  });

  it('space pages down, b pages up, G goes to the end, g to the top, with the status line pinned', async () => {
    const view = await mountInteractive(
      manyLines(30),
      60,
      'never',
      'unicode',
      10,
    );
    await view.press(' ');
    let lines = visibleLines(view.lastFrame());
    expect(lines[0]).not.toBe('line 1');
    expect(lines[lines.length - 1]).toContain('nothing focusable');
    await view.press('G');
    lines = visibleLines(view.lastFrame());
    expect(lines).toContain('line 30');
    expect(lines[lines.length - 1]).toContain('nothing focusable');
    await view.press('b');
    expect(visibleLines(view.lastFrame())).not.toContain('line 30');
    await view.press('g');
    expect(visibleLines(view.lastFrame())[0]).toBe('line 1');
    view.unmount();
  });

  it('j and k scroll a line at a time when nothing is focusable, and never past either end', async () => {
    const view = await mountInteractive(
      manyLines(30),
      60,
      'never',
      'unicode',
      10,
    );
    await view.press('k');
    expect(visibleLines(view.lastFrame())[0]).toBe('line 1');
    await view.press('j');
    await view.press('j');
    expect(visibleLines(view.lastFrame())[0]).not.toBe('line 1');
    await view.press('G');
    await view.press('G');
    await view.press('j');
    expect(visibleLines(view.lastFrame())).toContain('line 30');
    view.unmount();
  });

  it('scrolls a newly focused block into view', async () => {
    const doc = `:::details{title="Near"}\nbody\n:::\n\n${manyLines(20)}\n\n:::details{title="Far away"}\nbody\n:::\n`;
    const view = await mountInteractive(doc, 60, 'never', 'unicode', 10);
    expect(view.lastFrame()).not.toContain('Far away');
    // Focus starts on the first block; moving to the second scrolls to it.
    await view.press('j');
    expect(view.lastFrame()).toContain('Far away');
    view.unmount();
  });

  it('keeps a details block visible after it opens below the fold', async () => {
    const doc = `${manyLines(8)}\n\n:::details{title="Open me"}\n${manyLines(6)}\n:::\n`;
    const view = await mountInteractive(doc, 60, 'never', 'unicode', 10);
    await view.press('\r');
    expect(view.lastFrame()).toContain('Open me');
    view.unmount();
  });

  it('a document shorter than the viewport leaves the status line at the bottom', async () => {
    const view = await mountInteractive('short\n', 60, 'never', 'unicode', 10);
    const raw = view.lastFrame().replace(/\x1b\[[0-9?;]*[a-zA-Z]/g, '');
    const rows = raw.split('\n');
    expect(rows[0]).toBe('short');
    expect(rows.findIndex((row) => row.includes('nothing focusable'))).toBe(9);
    view.unmount();
  });
});

describe('the re-run key', () => {
  const NOTE = 'plain text\n';

  it('calls the host callback, shows running meanwhile, and ignores r while it runs', async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const view = await mountInteractive(
      NOTE,
      200,
      'never',
      'unicode',
      undefined,
      () => {
        calls += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    );
    expect(view.lastFrame()).toContain('r run');
    await view.press('r');
    expect(calls).toBe(1);
    expect(view.lastFrame()).toContain('running');
    await view.press('r');
    expect(calls).toBe(1);
    finish();
    await tick();
    expect(view.lastFrame()).not.toContain('running');
    await view.press('r');
    expect(calls).toBe(2);
    view.unmount();
  });

  it('survives a callback that rejects', async () => {
    let calls = 0;
    const view = await mountInteractive(
      NOTE,
      200,
      'never',
      'unicode',
      undefined,
      () => {
        calls += 1;
        return Promise.reject(new Error('no'));
      },
    );
    await view.press('r');
    await tick();
    expect(view.lastFrame()).not.toContain('running');
    await view.press('r');
    expect(calls).toBe(2);
    view.unmount();
  });

  it('is absent from the legend and does nothing without a callback', async () => {
    const view = await mountInteractive(NOTE, 200);
    expect(view.lastFrame()).not.toContain('r run');
    await view.press('r');
    expect(view.lastFrame()).not.toContain('running');
    view.unmount();
  });

  it('lists the key in the ascii legend in 7-bit characters', async () => {
    const view = await mountInteractive(
      NOTE,
      200,
      'never',
      'ascii',
      undefined,
      () => {},
    );
    const frame = view.lastFrame();
    expect(frame).toContain('r run');
    expect([...frame].filter((ch) => ch.charCodeAt(0) > 0x7f)).toEqual([]);
    view.unmount();
  });
});
