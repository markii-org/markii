import { describe, expect, it } from 'vitest';
import {
  bold,
  carrySgrAcrossLines,
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
import { stripEscapes } from './text-grid.js';

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
    expect(stripEscapes(colorize('x', RED, 'truecolor'))).toBe('x');
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

  it('bold/dim/italic/underline/inverse each wrap with the matching SGR code and a full reset', () => {
    expect(bold('x', '16')).toBe('\x1b[1mx\x1b[0m');
    expect(dim('x', '16')).toBe('\x1b[2mx\x1b[0m');
    expect(italic('x', '16')).toBe('\x1b[3mx\x1b[0m');
    expect(underline('x', '16')).toBe('\x1b[4mx\x1b[0m');
    expect(inverse('x', '16')).toBe('\x1b[7mx\x1b[0m');
  });

  it('re-opens after an inner reset so nesting composes', () => {
    const inner = bold('mid', '16');
    const outer = dim(`before ${inner} after`, '16');
    // The inner bold's own reset would otherwise cancel the outer dim too;
    // dim must reopen itself right after it.
    expect(outer).toContain(`\x1b[0m\x1b[2m after`);
  });

  it('hyperlink emits OSC 8 only above level none, and leaves the plain form to the caller at none', () => {
    expect(hyperlink('text', 'https://example.com', 'none')).toBe('text');
    expect(hyperlink('text', 'https://example.com', '16')).toBe(
      '\x1b]8;;https://example.com\x07text\x1b]8;;\x07',
    );
  });
});

describe('detectColorLevel', () => {
  it('reads nothing on its own: identical env/isTTY in, identical level out, deterministically', () => {
    expect(detectColorLevel({}, false)).toBe('none');
    expect(detectColorLevel({ COLORTERM: 'truecolor' }, true)).toBe(
      'truecolor',
    );
  });

  it('NO_COLOR wins over everything else', () => {
    expect(detectColorLevel({ NO_COLOR: '1', FORCE_COLOR: '3' }, true)).toBe(
      'none',
    );
  });
});

describe('resolveColorOption', () => {
  it("'auto' and undefined both mean no escapes, since this engine has no environment knowledge", () => {
    expect(resolveColorOption('auto')).toBe('none');
    expect(resolveColorOption(undefined)).toBe('none');
    expect(resolveColorOption('never')).toBe('none');
  });

  it('passes an explicit level through unchanged', () => {
    expect(resolveColorOption('16')).toBe('16');
    expect(resolveColorOption('256')).toBe('256');
    expect(resolveColorOption('truecolor')).toBe('truecolor');
  });
});

describe('carrySgrAcrossLines', () => {
  it('is a no-op for a string with no embedded newline', () => {
    const text = dim('one line', '16');
    expect(carrySgrAcrossLines(text)).toBe(text);
  });

  it('closes an open span before an embedded newline and reopens it on the next line', () => {
    const styled = dim('first\nsecond\nthird', '16');
    const repaired = carrySgrAcrossLines(styled);
    const lines = repaired.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // Every physical line is independently open-then-closed: this is
      // exactly what makes it safe for Ink to reset SGR state at each line
      // boundary, since each line already carries its own open and close.
      expect(line.startsWith('\x1b[2m')).toBe(true);
      expect(line.endsWith('\x1b[0m')).toBe(true);
    }
    expect(stripEscapes(repaired)).toBe('first\nsecond\nthird');
  });

  it('a styled string long enough to word-wrap keeps its style on every resulting line (the reported Ink regression)', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    // Simulates this engine's own heading/paragraph pipeline: style the
    // whole logical line, THEN word-wrap it into physical lines with
    // text-grid's escape-aware wrapText, THEN join with '\n' — exactly the
    // shape `render.tsx`'s heading/paragraph rendering produces.
    const styled = underline(bold(words, '16'), '16');
    // A minimal stand-in for text-grid's wrapText: break every 3 words,
    // keeping the leading/trailing escape atoms wherever they land.
    const plainWords = words.split(' ');
    const chunks: string[] = [];
    for (let i = 0; i < plainWords.length; i += 3) {
      chunks.push(plainWords.slice(i, i + 3).join(' '));
    }
    // Re-inject the styling the same way `styled` carries it: open at the
    // very start, close at the very end, joined by '\n' — the shape a
    // pre-Ink engine could safely emit as one continuous escape run.
    const openCode = styled.slice(0, styled.indexOf('m') + 1);
    const closeCode = '\x1b[0m';
    const rawMultiline = `${openCode}${chunks.join('\n')}${closeCode}`;

    const repaired = carrySgrAcrossLines(rawMultiline);
    const lines = repaired.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).toMatch(/^\x1b\[[0-9;]*m/);
      expect(line.endsWith('\x1b[0m')).toBe(true);
    }
    expect(stripEscapes(repaired)).toBe(chunks.join('\n'));
  });

  it('a bare reset (`ESC [ m`, no parameter) also clears the open-state tracker', () => {
    const text = `\x1b[2mfirst\x1b[mnext\nsecond`;
    const repaired = carrySgrAcrossLines(text);
    // Nothing was still open when the newline was reached (the bare reset
    // already cleared it), so line two gets no reopened prefix.
    expect(repaired.split('\n')[1]).toBe('second');
  });
});
