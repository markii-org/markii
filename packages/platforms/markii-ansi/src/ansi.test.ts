import { describe, expect, it } from 'vitest';
import {
  bold,
  colorize,
  detectColorLevel,
  dim,
  fg,
  hyperlink,
  inverse,
  italic,
  resolveColorOption,
  underline,
  type AnsiColor,
} from './ansi.js';
import { stripAnsi } from './measure.js';

const RED: AnsiColor = { ansi16: 31, ansi256: 196, truecolor: [220, 38, 38] };

describe('fg / colorize', () => {
  it('emits nothing at level none', () => {
    expect(fg(RED, 'none')).toBe('');
    expect(colorize('x', RED, 'none')).toBe('x');
  });

  it('emits a 16-color SGR code', () => {
    expect(colorize('x', RED, '16')).toBe('\x1b[31mx\x1b[0m');
  });

  it('emits a 256-color SGR code', () => {
    expect(colorize('x', RED, '256')).toBe('\x1b[38;5;196mx\x1b[0m');
  });

  it('emits a truecolor SGR code', () => {
    expect(colorize('x', RED, 'truecolor')).toBe(
      '\x1b[38;2;220;38;38mx\x1b[0m',
    );
  });

  it('leaves no escape state open: stripping known escapes leaves the plain text', () => {
    expect(stripAnsi(colorize('x', RED, 'truecolor'))).toBe('x');
  });
});

describe('style wrappers', () => {
  it('return text unchanged at level none', () => {
    expect(bold('x', 'none')).toBe('x');
    expect(dim('x', 'none')).toBe('x');
    expect(italic('x', 'none')).toBe('x');
    expect(underline('x', 'none')).toBe('x');
    expect(inverse('x', 'none')).toBe('x');
  });

  it('wrap with the right SGR code and reset', () => {
    expect(bold('x', '16')).toBe('\x1b[1mx\x1b[0m');
    expect(dim('x', '16')).toBe('\x1b[2mx\x1b[0m');
    expect(italic('x', '16')).toBe('\x1b[3mx\x1b[0m');
    expect(underline('x', '16')).toBe('\x1b[4mx\x1b[0m');
    expect(inverse('x', '16')).toBe('\x1b[7mx\x1b[0m');
  });
});

describe('hyperlink', () => {
  it('returns text unchanged at level none, no OSC 8', () => {
    expect(hyperlink('click', 'https://example.com', 'none')).toBe('click');
  });

  it('emits OSC 8 open/close at a color level', () => {
    expect(hyperlink('click', 'https://example.com', '16')).toBe(
      '\x1b]8;;https://example.com\x07click\x1b]8;;\x07',
    );
  });
});

describe('detectColorLevel', () => {
  it('NO_COLOR set to any non-empty value forces none, even on a TTY with FORCE_COLOR set', () => {
    expect(detectColorLevel({ NO_COLOR: '1', FORCE_COLOR: '3' }, true)).toBe(
      'none',
    );
  });

  it('an empty NO_COLOR does not force none', () => {
    expect(detectColorLevel({ NO_COLOR: '' }, true)).toBe('16');
  });

  it('FORCE_COLOR=0 forces none', () => {
    expect(detectColorLevel({ FORCE_COLOR: '0' }, true)).toBe('none');
  });

  it('FORCE_COLOR=1 and =true force 16', () => {
    expect(detectColorLevel({ FORCE_COLOR: '1' }, true)).toBe('16');
    expect(detectColorLevel({ FORCE_COLOR: 'true' }, true)).toBe('16');
  });

  it('FORCE_COLOR=2 forces 256', () => {
    expect(detectColorLevel({ FORCE_COLOR: '2' }, true)).toBe('256');
  });

  it('FORCE_COLOR=3 forces truecolor', () => {
    expect(detectColorLevel({ FORCE_COLOR: '3' }, true)).toBe('truecolor');
  });

  it('a non-TTY with no FORCE_COLOR gives none', () => {
    expect(detectColorLevel({}, false)).toBe('none');
  });

  it('TERM=dumb gives none on a TTY', () => {
    expect(detectColorLevel({ TERM: 'dumb' }, true)).toBe('none');
  });

  it('COLORTERM truecolor/24bit gives truecolor', () => {
    expect(detectColorLevel({ COLORTERM: 'truecolor' }, true)).toBe(
      'truecolor',
    );
    expect(detectColorLevel({ COLORTERM: '24bit' }, true)).toBe('truecolor');
  });

  it('a TERM containing 256color gives 256', () => {
    expect(detectColorLevel({ TERM: 'xterm-256color' }, true)).toBe('256');
  });

  it('otherwise gives 16', () => {
    expect(detectColorLevel({ TERM: 'xterm' }, true)).toBe('16');
  });
});

describe('resolveColorOption', () => {
  it('never and auto both resolve to none', () => {
    expect(resolveColorOption('never')).toBe('none');
    expect(resolveColorOption('auto')).toBe('none');
  });

  it('undefined behaves as auto', () => {
    expect(resolveColorOption(undefined)).toBe('none');
  });

  it('the three explicit levels pass through', () => {
    expect(resolveColorOption('16')).toBe('16');
    expect(resolveColorOption('256')).toBe('256');
    expect(resolveColorOption('truecolor')).toBe('truecolor');
  });
});

describe('nested styling', () => {
  it('restores the outer attribute after an inner reset, so nesting does not cancel it', () => {
    const nested = dim(`frame ${bold('LABEL', '16')} tail`, '16');
    // The inner bold closes with a full reset (SGR has no per-attribute
    // undo), so the outer dim has to be re-opened for the remainder.
    expect(nested).toBe('\x1b[2mframe \x1b[1mLABEL\x1b[0m\x1b[2m tail\x1b[0m');
  });

  it('restores an outer color after an inner reset', () => {
    const color = {
      ansi16: 31,
      ansi256: 196,
      truecolor: [220, 38, 38],
    } as const;
    const nested = colorize(
      `a ${bold('b', 'truecolor')} c`,
      color,
      'truecolor',
    );
    expect(nested).toBe(
      '\x1b[38;2;220;38;38ma \x1b[1mb\x1b[0m\x1b[38;2;220;38;38m c\x1b[0m',
    );
  });

  it('leaves no escape state open: the string ends with a reset', () => {
    expect(dim(`x ${bold('y', '16')} z`, '16').endsWith('\x1b[0m')).toBe(true);
  });
});
