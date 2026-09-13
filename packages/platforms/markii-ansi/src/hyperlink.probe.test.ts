import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from './render.js';

/**
 * Executed probe: an OSC 8 sequence is emitted ONLY for a href
 * `@markii/core`'s `isSafeUrl` accepts, only when the color level is not
 * `'none'`, and never for a `javascript:` href or one carrying a BEL (see
 * `render.ts`'s `renderLink`, and this suite's sibling
 * `control-characters.probe.test.ts` for the broader control-character
 * sweep). AGENTS.md requires an executed probe for this kind of
 * security-relevant behavior.
 */

const OSC8_START = '\x1b]8;;';

describe('hyperlink emission (executed probe)', () => {
  it('emits OSC 8 for a safe https: link at a color level', async () => {
    const output = await renderMarkToAnsi(
      '[click here](https://example.com)\n',
      undefined,
      undefined,
      undefined,
      {
        color: '16',
      },
    );
    expect(output).toContain(OSC8_START);
    expect(output).toContain('https://example.com');
  });

  it('never emits OSC 8 at color level none, even for a safe link', async () => {
    const output = await renderMarkToAnsi(
      '[click here](https://example.com)\n',
      undefined,
      undefined,
      undefined,
      {
        color: 'never',
      },
    );
    expect(output).not.toContain(OSC8_START);
    expect(output).toContain('(https://example.com)');
  });

  it('never emits OSC 8 for a javascript: href, at any color level', async () => {
    const output = await renderMarkToAnsi(
      '[click here](javascript:alert(1))\n',
      undefined,
      undefined,
      undefined,
      {
        color: 'truecolor',
      },
    );
    expect(output).not.toContain(OSC8_START);
  });

  it('never emits OSC 8 for a href resolved to carry a BEL', async () => {
    const output = await renderMarkToAnsi(
      '[click here](notes/a)\n',
      undefined,
      undefined,
      undefined,
      {
        color: 'truecolor',
        resolveHref: () => 'https://example.com/\x07evil',
      },
    );
    expect(output).not.toContain(OSC8_START);
  });

  it('never emits OSC 8 for a href carrying an ESC byte', async () => {
    const output = await renderMarkToAnsi(
      '[click here](notes/a)\n',
      undefined,
      undefined,
      undefined,
      {
        color: 'truecolor',
        resolveHref: () => 'https://example.com/\x1b[31m',
      },
    );
    expect(output).not.toContain(OSC8_START);
  });

  it('emits OSC 8 for a resolved href that resolves to a safe, unmodified URL', async () => {
    const output = await renderMarkToAnsi(
      '[click here](notes/a)\n',
      undefined,
      undefined,
      undefined,
      {
        color: '256',
        resolveHref: () => 'https://resolved.example.com/a',
      },
    );
    expect(output).toContain(OSC8_START);
    expect(output).toContain('https://resolved.example.com/a');
  });

  it('never emits OSC 8 for a vbscript: href', async () => {
    const output = await renderMarkToAnsi(
      '[click here](vbscript:msgbox(1))\n',
      undefined,
      undefined,
      undefined,
      {
        color: 'truecolor',
      },
    );
    expect(output).not.toContain(OSC8_START);
  });
});
