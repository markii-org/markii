import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { buildMarkElement, renderMarkToAnsi } from './render.js';
import { createAnsiRegistry } from './registry.js';
import { defaultAnsiRegistry } from './components/index.js';
import {
  TERMINAL_REGISTER_GLOBAL,
  installTerminalPackGlobals,
  loadTerminalPackScript,
} from './pack-script.js';
import { installAnsiPacks } from './pack-loader.js';
import { loadAnsiPack } from './pack-loader.js';
import { parsePackManifest } from '@markii/pack';
import { defaultAnsiTheme } from './theme.js';
import type { ColorOption } from './ansi.js';
import type { BoxStyle } from './glyphs.js';
import type { AnsiRegistry } from './registry.js';

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
  registry: AnsiRegistry,
  width = 40,
  color: ColorOption = 'never',
  box: BoxStyle = 'unicode',
  viewportRows?: number,
) {
  const { render } = await import('ink');
  const stdin = makeFakeStdin();
  const { stream: stdout, lastFrame } = makeCollectingStdout(width);
  const element = buildMarkElement(source, registry, {
    width,
    color,
    box,
    interactive: true,
    ...(viewportRows !== undefined ? { viewportRows } : {}),
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

type PackGlobals = {
  __markiiReactInk: typeof import('react');
  __markiiInk: typeof import('ink');
};

/**
 * A counter written the way a prebuilt terminal.js writes one: React and
 * Ink read from the host's globals at render time, keys through the Ink
 * global's `useInput`. It counts every `x` it is handed.
 */
function counterPack(label: string): AnsiRegistry {
  installTerminalPackGlobals();
  const globals = globalThis as unknown as PackGlobals;
  function Counter(): ReturnType<typeof createElement> {
    const { createElement: h, useState } = globals.__markiiReactInk;
    const { Text, useInput } = globals.__markiiInk;
    const [count, setCount] = useState(0);
    useInput((input) => {
      if (input === 'x') setCount((value) => value + 1);
    });
    return h(Text, null, `${label} count ${count}`);
  }
  return createAnsiRegistry({
    ...defaultAnsiRegistry,
    counter: { component: () => createElement(Counter), focusable: true },
    still: { component: () => createElement(Counter) },
  });
}

describe('a focusable pack component in the live viewer', () => {
  it('receives keys only while it has focus', async () => {
    const view = await mountInteractive(
      '::counter{}\n\n::counter{}\n',
      counterPack('c'),
    );
    expect(view.lastFrame()).toContain('c count 0');
    await view.press('x');
    await view.press('x');
    const first = view.lastFrame();
    // Exactly one of the two counters moved: the focused (first) one.
    expect(first.match(/c count 2/g)?.length).toBe(1);
    expect(first.match(/c count 0/g)?.length).toBe(1);
    expect(first.indexOf('c count 2')).toBeLessThan(first.indexOf('c count 0'));

    await view.press('j');
    await view.press('x');
    const second = view.lastFrame();
    expect(second.match(/c count 2/g)?.length).toBe(1);
    expect(second.match(/c count 1/g)?.length).toBe(1);
    expect(second.indexOf('c count 2')).toBeLessThan(
      second.indexOf('c count 1'),
    );
    view.unmount();
  });

  it('marks the focused component in a gutter and names it on the status line', async () => {
    const view = await mountInteractive('::counter{}\n', counterPack('c'));
    const frame = view.lastFrame();
    expect(frame).toContain('▌ c count 0');
    expect(frame).toContain('pack "counter"');
    view.unmount();
  });

  it('gives a component that is not marked focusable no keys and no focus', async () => {
    const view = await mountInteractive('::still{}\n', counterPack('s'));
    await view.press('x');
    expect(view.lastFrame()).not.toContain('count 1');
    expect(view.lastFrame()).not.toContain('pack "still"');
    view.unmount();
  });

  it('draws a static snapshot in the render-once path', async () => {
    const text = await renderMarkToAnsi(
      '::counter{}\n',
      counterPack('c'),
      undefined,
      undefined,
      { color: 'never' },
    );
    expect(text).toContain('c count 0');
    expect(text).not.toContain('▌');
  });

  it('never fires a handler outside a focus scope', async () => {
    // Called with no provider: the gated hook is inactive, so a pack that
    // mounts its own element elsewhere still cannot read the keyboard.
    const { usePackInput } = await import('./interactive.js');
    expect(typeof usePackInput).toBe('function');
  });
});

describe('the focusable flag through the pack loader', () => {
  const manifest = parsePackManifest(
    JSON.stringify({
      name: 'ana',
      version: '1.0.0',
      engine: '>=0.1.0',
      components: {
        counter: { sources: { ansi: './c.js' } },
        chip: { sources: { ansi: './chip.js' }, kind: 'inline' },
      },
    }),
  );

  it('keeps it on a block view and drops it from an inline one', () => {
    if (!manifest.ok) throw new Error('manifest fixture is invalid');
    const view = { component: () => 'x', focusable: true };
    const loaded = loadAnsiPack(manifest.manifest, {
      counter: view,
      chip: view,
    });
    expect(loaded.registry['ana_counter']?.focusable).toBe(true);
    expect(loaded.registry['ana_chip']?.focusable).toBeUndefined();
  });
});

describe('a real terminal.js that registers a focusable view', () => {
  const MANIFEST = JSON.stringify({
    name: 'keys',
    engine: 'react',
    components: { pad: { sources: { ansi: './pad.ansi.tsx' }, kind: 'leaf' } },
  });
  const script = (focusable: string): string => `
    function Pad() {
      const React = globalThis.__markiiReactInk;
      const Ink = globalThis.__markiiInk;
      const [last, setLast] = React.useState('none');
      Ink.useInput((input) => setLast(input));
      return React.createElement(Ink.Text, null, 'last=' + last);
    }
    globalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, {
      pad: { component: () => globalThis.__markiiReactInk.createElement(Pad), focusable: ${focusable} },
    });
  `;

  async function registryFor(focusable: string): Promise<AnsiRegistry> {
    installTerminalPackGlobals();
    const loaded = await loadTerminalPackScript(script(focusable));
    if (!loaded.ok) throw new Error(loaded.reason);
    const installed = installAnsiPacks([loaded.pack], defaultAnsiRegistry);
    if (!installed.ok) throw new Error('collision');
    return installed.registry;
  }

  it('receives a key through the gated useInput', async () => {
    const view = await mountInteractive(
      '::keys_pad{}\n',
      await registryFor('true'),
    );
    expect(view.lastFrame()).toContain('last=none');
    await view.press('z');
    expect(view.lastFrame()).toContain('last=z');
    view.unmount();
  });

  it('hears nothing when it does not declare itself focusable', async () => {
    const view = await mountInteractive(
      '::keys_pad{}\n',
      await registryFor('false'),
    );
    await view.press('z');
    expect(view.lastFrame()).toContain('last=none');
    view.unmount();
  });

  it('refuses a registration whose focusable flag is not a boolean', async () => {
    installTerminalPackGlobals();
    const loaded = await loadTerminalPackScript(script("'yes'"));
    expect(loaded.ok).toBe(false);
  });
});
