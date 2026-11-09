import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from './render.js';
import { installAnsiPacks } from './pack-loader.js';
import { loadTerminalPackScript } from './pack-script.js';
import { defaultAnsiRegistry } from './components/index.js';

/**
 * The terminal registration contract, exercised against a HAND-WRITTEN
 * `terminal.js`.
 *
 * The scripts below are written from docs/packs.md ("What a prebuilt
 * `terminal.js` must do") and from nothing else: they never touch a pack
 * build, a helper from this package, or the probe suite's fixtures. The
 * contract is public, and the markii-packs repository carries a second
 * implementation of it, so a test that only feeds the loader its own
 * output would let the document and the loader drift apart silently. If
 * the registration convention changes without the document, this fails
 * and names the rule it broke.
 *
 * It is the twin of `@markii/host`'s `pack-contract.test.ts`, which does
 * the same for `webview.js`.
 */

const MANIFEST = {
  name: 'demo',
  engine: 'react',
  version: '1.0.0',
  components: {
    hello: {
      sources: { react: './hello.tsx', ansi: './hello.ansi.tsx' },
      description: 'A greeting.',
    },
    chip: {
      sources: { react: './chip.tsx', ansi: './chip.ansi.tsx' },
      kind: 'inline',
    },
  },
};

/**
 * An ECMAScript module with no imports. One registration call, the raw
 * `pack.json` text as a string, and an own-property map of
 * `{ component, inline? }`. React and Ink are read from the published
 * globals only inside functions that run at render time.
 */
const HAND_WRITTEN_TERMINAL_JS = `
var manifestJson = ${JSON.stringify(JSON.stringify(MANIFEST, null, 2))};

function Hello(props) {
  var React = globalThis.__markiiReactInk;
  var Ink = globalThis.__markiiInk;
  return React.createElement(
    Ink.Text,
    null,
    'hello ' + props.attributes.name + ' / ' + (typeof props.ctx.text),
  );
}

function Chip(props) {
  return '<' + props.children + '>';
}

globalThis.__markiiRegisterTerminalPack(manifestJson, {
  hello: { component: Hello },
  chip: { component: Chip, inline: true },
});
`;

const g = globalThis as Record<string, unknown>;
const SAVED = {
  react: g['__markiiReactInk'],
  ink: g['__markiiInk'],
};

afterEach(() => {
  g['__markiiReactInk'] = SAVED.react;
  g['__markiiInk'] = SAVED.ink;
});

async function render(
  source: string,
  script: string = HAND_WRITTEN_TERMINAL_JS,
): Promise<string> {
  const loaded = await loadTerminalPackScript(script);
  if (!loaded.ok) throw new Error(loaded.reason);
  const installed = installAnsiPacks([loaded.pack], defaultAnsiRegistry);
  if (!installed.ok) throw new Error('namespace collision');
  return renderMarkToAnsi(source, installed.registry, undefined, undefined, {
    color: 'never',
  });
}

describe('a hand-written terminal.js (docs/packs.md contract)', () => {
  it('loads with React and Ink unpublished, because it reads them only at render time', async () => {
    delete g['__markiiReactInk'];
    delete g['__markiiInk'];
    const loaded = await loadTerminalPackScript(HAND_WRITTEN_TERMINAL_JS);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.pack.manifest.name).toBe('demo');
      expect(Object.keys(loaded.pack.componentModules).sort()).toEqual([
        'chip',
        'hello',
      ]);
    }
  });

  it('registers under the pack-prefixed names and renders an Ink element view', async () => {
    const out = await render('::demo_hello{name=ana}');
    expect(out).toContain('hello ana / function');
  });

  it('renders a string-returning inline view with its children', async () => {
    const out = await render('see :demo_chip[x] here');
    expect(out).toContain('<x>');
  });

  it('does not register a bare, unprefixed name', async () => {
    const out = await render('::hello{name=ana}');
    expect(out).toContain('unknown component `hello`');
  });
});

describe('what the contract says is rejected', () => {
  const reject = async (script: string): Promise<string> => {
    const loaded = await loadTerminalPackScript(script);
    expect(loaded.ok).toBe(false);
    return loaded.ok ? '' : loaded.reason;
  };

  it('a script that throws', async () => {
    expect(await reject('throw new Error("boom");')).toContain('boom');
  });

  it('a script that registers nothing', async () => {
    await reject('var x = 1;');
  });

  it('a script that registers twice', async () => {
    await reject(`
      var m = ${JSON.stringify(JSON.stringify(MANIFEST))};
      var c = { hello: { component: function () { return ''; } } };
      globalThis.__markiiRegisterTerminalPack(m, c);
      globalThis.__markiiRegisterTerminalPack(m, c);
    `);
  });

  it('a malformed manifest', async () => {
    await reject(
      'globalThis.__markiiRegisterTerminalPack("not json", { hello: { component: function () { return ""; } } });',
    );
  });

  it('a malformed component map', async () => {
    await reject(
      `globalThis.__markiiRegisterTerminalPack(${JSON.stringify(JSON.stringify(MANIFEST))}, { hello: { component: 3 } });`,
    );
  });
});
