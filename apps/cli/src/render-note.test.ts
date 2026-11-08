import { describe, expect, it } from 'vitest';
import { createFakeTerminal } from './test-terminal.js';
import {
  buildViewElement,
  detectBoxStyle,
  renderNote,
  resolveBox,
  resolveColor,
  resolveWidth,
} from './render-note.js';

describe('resolveWidth', () => {
  it('prefers an explicit --width', () => {
    expect(resolveWidth(120, { columns: 80 })).toBe(120);
  });

  it('falls back to the terminal columns', () => {
    expect(resolveWidth(undefined, { columns: 100 })).toBe(100);
  });

  it('falls back to 80 with no width flag and no terminal columns', () => {
    expect(resolveWidth(undefined, { columns: undefined })).toBe(80);
  });

  it('falls back to 80 when the terminal reports zero columns', () => {
    expect(resolveWidth(undefined, { columns: 0 })).toBe(80);
  });
});

describe('resolveColor', () => {
  it('detects from the environment and TTY-ness when unset', () => {
    expect(resolveColor(undefined, { env: {}, stdoutIsTty: false })).toBe(
      'none',
    );
    expect(
      resolveColor(undefined, {
        env: { COLORTERM: 'truecolor' },
        stdoutIsTty: true,
      }),
    ).toBe('truecolor');
  });

  it('detects the same way for an explicit "auto"', () => {
    expect(
      resolveColor('auto', {
        env: { COLORTERM: 'truecolor' },
        stdoutIsTty: true,
      }),
    ).toBe('truecolor');
  });

  it('honours NO_COLOR even when a TTY is present', () => {
    expect(
      resolveColor(undefined, {
        env: { NO_COLOR: '1' },
        stdoutIsTty: true,
      }),
    ).toBe('none');
  });

  it('"never" always resolves to none, TTY or not', () => {
    expect(resolveColor('never', { env: {}, stdoutIsTty: true })).toBe('none');
    expect(resolveColor('never', { env: {}, stdoutIsTty: false })).toBe('none');
  });

  it('an explicit level wins over a non-TTY stdout', () => {
    expect(resolveColor('truecolor', { env: {}, stdoutIsTty: false })).toBe(
      'truecolor',
    );
  });

  it('passes through 16 and 256 explicitly', () => {
    expect(resolveColor('16', { env: {}, stdoutIsTty: false })).toBe('16');
    expect(resolveColor('256', { env: {}, stdoutIsTty: false })).toBe('256');
  });
});

describe('detectBoxStyle', () => {
  it('is unicode with no locale or TERM to go on', () => {
    expect(detectBoxStyle({})).toBe('unicode');
  });

  it('is ascii for TERM=dumb, whatever the locale', () => {
    expect(detectBoxStyle({ TERM: 'dumb', LANG: 'en_US.UTF-8' })).toBe('ascii');
  });

  it('follows the first locale variable that is set: LC_ALL, LC_CTYPE, LANG', () => {
    expect(detectBoxStyle({ LANG: 'en_US.UTF-8' })).toBe('unicode');
    expect(detectBoxStyle({ LANG: 'C' })).toBe('ascii');
    expect(detectBoxStyle({ LC_ALL: 'POSIX', LANG: 'en_US.UTF-8' })).toBe(
      'ascii',
    );
    expect(detectBoxStyle({ LC_CTYPE: 'de_DE.utf8', LANG: 'C' })).toBe(
      'unicode',
    );
    expect(detectBoxStyle({ LC_ALL: '', LANG: 'C.UTF-8' })).toBe('unicode');
  });
});

describe('resolveBox', () => {
  it('prefers an explicit --box over the environment', () => {
    expect(resolveBox('unicode', { env: { TERM: 'dumb' } })).toBe('unicode');
    expect(resolveBox('ascii', { env: { LANG: 'en_US.UTF-8' } })).toBe('ascii');
  });

  it('detects from the environment when unset', () => {
    expect(resolveBox(undefined, { env: { LANG: 'C' } })).toBe('ascii');
  });
});

describe('renderNote box style', () => {
  it('draws a card with ASCII frames on a dumb terminal', async () => {
    const out = await renderNote(
      ':::card{title="T"}\nx\n:::\n',
      createFakeTerminal({ env: { TERM: 'dumb' }, columns: 20 }),
      { colorFlag: 'never' },
    );
    expect(out.split('\n')[0]).toBe('+- T --------------+');
    expect([...out].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
  });
});

describe('buildViewElement rows', () => {
  const terminal = createFakeTerminal();

  it('hands the terminal rows to the engine as the viewport', () => {
    const element = buildViewElement('hello\n', terminal, 80, { rows: 24 });
    expect(element.props).toMatchObject({ viewportRows: 24, width: 80 });
  });

  it('leaves the view unbounded when no rows are known', () => {
    const element = buildViewElement('hello\n', terminal, 80);
    expect(element.props).not.toHaveProperty('viewportRows', 24);
    expect((element.props as { viewportRows?: number }).viewportRows).toBe(
      undefined,
    );
  });
});
