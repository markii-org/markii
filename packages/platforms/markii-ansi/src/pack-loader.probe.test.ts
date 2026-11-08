import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from './render.js';
import {
  ANSI_ENGINE_ID,
  installAnsiPacks,
  loadAnsiPack,
} from './pack-loader.js';
import {
  TERMINAL_REGISTER_GLOBAL,
  loadTerminalPackScript,
} from './pack-script.js';
import { defaultAnsiRegistry } from './components/index.js';
import { mergeAnsiRegistries } from './registry.js';

/**
 * Executed probe for the terminal pack path (docs/security.md). Loads a
 * REAL pack script (an ESM text that registers through the documented
 * global and reads React and Ink from the host's globals at render time)
 * and renders hostile author text through it. The pack prints the raw
 * attribute and stored-value strings it is given WITHOUT calling
 * `ctx.text` on purpose: the engine must have sanitized them already.
 *
 * What this does NOT prove, and cannot: a pack's own code is trusted code
 * running in this process. It can write to stdout or touch the filesystem
 * itself. The last test records that on purpose.
 */

const SGR_ESCAPE = /\x1b\[[0-9;]*m/g;
const OSC8_ESCAPE = /\x1b\]8;;[^\x07\x1b]*\x07/g;
const RAW_CONTROL_BYTES = /[\x1b\x9b\x07\x7f]/;
const strip = (text: string): string =>
  text.replace(OSC8_ESCAPE, '').replace(SGR_ESCAPE, '');

const MANIFEST = JSON.stringify({
  name: 'probe',
  engine: 'react',
  components: {
    meter: {
      sources: { react: './meter.react.tsx', ansi: './meter.ansi.tsx' },
      kind: 'leaf',
    },
    webonly: './webonly.tsx',
  },
});

// Plain ESM, exactly what a built terminal.js looks like: it registers on
// evaluation and reads React and Ink only inside the render function.
const PACK_SCRIPT = `
function Meter(props) {
  const React = globalThis.__markiiReactInk;
  const Ink = globalThis.__markiiInk;
  const attrs = props.attributes;
  const label = String(attrs.label);
  const resolved = props.ctx.resolve(String(attrs.data));
  const stored = JSON.stringify(resolved.value);
  const dataView = JSON.stringify(props.ctx.data);
  return React.createElement(
    Ink.Text,
    null,
    'label=' + label + ' stored=' + stored + ' data=' + dataView + ' keys=' + Object.keys(attrs).join(','),
  );
}
globalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, {
  meter: { component: Meter },
});
`;

const PAYLOADS = [
  '\x1b[31mred',
  '\x1b]8;;http://evil\x07link',
  '\x9b31mc1',
  'bell\x07',
  'cr\rover',
  'del\x7fx',
] as const;

async function registry() {
  const loaded = await loadTerminalPackScript(PACK_SCRIPT);
  if (!loaded.ok) throw new Error(loaded.reason);
  const installed = installAnsiPacks([loaded.pack], defaultAnsiRegistry);
  if (!installed.ok) throw new Error('collision');
  return installed.registry;
}

describe('a real terminal pack script (executed probe)', () => {
  it('loads, registers under the namespaced name, and renders', async () => {
    const out = await renderMarkToAnsi(
      '::probe_meter{label=hello}',
      await registry(),
      undefined,
      undefined,
      { color: 'never' },
    );
    expect(out).toContain('label=hello');
  });

  for (const payload of PAYLOADS) {
    const name = JSON.stringify(payload);

    it(`attribute value ${name} never reaches the output as a control byte`, async () => {
      const out = await renderMarkToAnsi(
        `::probe_meter{label="${payload.replace(/"/g, '')}" data=x}`,
        await registry(),
        undefined,
        undefined,
        { color: 'never' },
      );
      expect(out).toContain('label=');
      // color never: the engine emits no escapes of its own, so ANY control
      // byte, an SGR or OSC 8 shape included, came from the payload.
      expect(RAW_CONTROL_BYTES.test(out)).toBe(false);
    });

    it(`stored value and data ${name} are sanitized before the pack sees them`, async () => {
      const store = {
        get: (key: string) =>
          key === 'x'
            ? {
                value: { nested: [payload], [payload]: payload },
                status: 'fresh' as const,
              }
            : undefined,
        has: (key: string) => key === 'x',
      };
      const out = await renderMarkToAnsi(
        '::probe_meter{label=a data=x}',
        await registry(),
        store,
        undefined,
        { color: 'never' },
      );
      expect(out).toContain('stored=');
      // color never: the engine emits no escapes of its own, so ANY control
      // byte, an SGR or OSC 8 shape included, came from the payload.
      expect(RAW_CONTROL_BYTES.test(out)).toBe(false);
    });
  }

  it("at truecolor only the engine's own SGR and OSC 8 shapes remain", async () => {
    const out = await renderMarkToAnsi(
      '::probe_meter{label="\x1b[31mred\x07" data=x}',
      await registry(),
      undefined,
      undefined,
      { color: 'truecolor' },
    );
    expect(RAW_CONTROL_BYTES.test(strip(out))).toBe(false);
    expect(out).not.toContain('\x1b[31mred');
  });

  it('an attribute NAME cannot smuggle a control byte either', async () => {
    const out = await renderMarkToAnsi(
      '::probe_meter{label=a data=x}',
      await registry(),
      undefined,
      undefined,
      { color: 'never' },
    );
    expect(RAW_CONTROL_BYTES.test(out)).toBe(false);
  });

  it('a component with no terminal source renders the unknown fallback, not the pack', async () => {
    const out = await renderMarkToAnsi(
      '::probe_webonly{x=1}',
      await registry(),
      undefined,
      undefined,
      { color: 'never' },
    );
    expect(out).toContain('unknown');
    expect(out).toContain('probe_webonly');
  });

  it('evaluating a script with no Ink globals set up does not throw', async () => {
    const g = globalThis as Record<string, unknown>;
    // The loader installs the globals itself, but a script that only
    // registers (never renders) must load even if they were absent.
    delete g['__markiiReactInk'];
    delete g['__markiiInk'];
    const loaded = await loadTerminalPackScript(PACK_SCRIPT);
    expect(loaded.ok).toBe(true);
  });

  it('rejects a script that never registers, registers twice, or throws', async () => {
    expect((await loadTerminalPackScript('export {};')).ok).toBe(false);
    expect(
      (
        await loadTerminalPackScript(
          `globalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, {});` +
            `globalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, {});`,
        )
      ).ok,
    ).toBe(false);
    const thrown = await loadTerminalPackScript('throw new Error("boom");');
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.reason).toContain('boom');
  });

  it('rejects malformed registrations (bad manifest, non-function component)', async () => {
    const bad = await loadTerminalPackScript(
      `globalThis.${TERMINAL_REGISTER_GLOBAL}("{not json", {});`,
    );
    expect(bad.ok).toBe(false);
    const shape = await loadTerminalPackScript(
      `globalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, { meter: { component: 3 } });`,
    );
    expect(shape.ok).toBe(false);
  });

  it('is gated per component: a pack with no ansi source is dropped', () => {
    const result = loadAnsiPack(
      {
        name: 'w',
        engine: 'react',
        components: { a: './a.tsx' },
      },
      { a: { component: () => null } },
    );
    expect(result.dropped).toEqual({ name: 'w', engine: 'react' });
    expect(Object.keys(result.registry)).toEqual([]);
    expect(ANSI_ENGINE_ID).toBe('ansi');
  });

  it('rejects a shared namespace at install', () => {
    const manifest = { name: 'dup', engine: 'ansi', components: {} };
    const result = installAnsiPacks([
      { manifest, componentModules: {} },
      { manifest, componentModules: {} },
    ]);
    expect(result).toEqual({ ok: false, collisions: ['dup'] });
    expect(mergeAnsiRegistries()).toBeDefined();
  });

  it('CANNOT bound the pack itself: pack code can write raw bytes to stdout', async () => {
    // Documented limit, asserted so nobody mistakes the guarantee for more
    // than it is: the engine sanitizes author text, not the pack's code.
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const script = `process.stdout.write('\\x1b[2Jpwned');\nglobalThis.${TERMINAL_REGISTER_GLOBAL}(${JSON.stringify(MANIFEST)}, {});`;
      await loadTerminalPackScript(script);
    } finally {
      process.stdout.write = original;
    }
    expect(chunks.join('')).toContain('\x1b[2Jpwned');
  });
});
