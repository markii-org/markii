import { describe, expect, it } from 'vitest';
import { colorize, type AnsiColor } from './ansi.js';
import { columns, frame, indentBlock, pad, rule, wrap } from './box.js';
import { measure } from './measure.js';

const RED: AnsiColor = { ansi16: 31, ansi256: 196, truecolor: [220, 38, 38] };

describe('wrap', () => {
  it('wraps at the word boundary nearest the width', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('treats an existing newline as a hard break', () => {
    expect(wrap('one\ntwo', 20)).toEqual(['one', 'two']);
  });

  it('breaks an over-long word at the width boundary', () => {
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never splits an escape sequence across a wrapped line', () => {
    const colored = colorize('abcdefgh', RED, '16');
    const lines = wrap(colored, 4);
    for (const line of lines) {
      // Every SGR escape actually present in this line must be a
      // complete, well-formed sequence: stripping all complete sequences
      // leaves no stray ESC byte behind.
      expect(line.replace(/\x1b\[[0-9;]*m/g, '')).not.toContain('\x1b');
    }
    expect(lines.join('')).toContain('\x1b[31m');
    expect(lines.join('')).toContain('\x1b[0m');
  });

  it('collapses multiple spaces between words', () => {
    expect(wrap('one   two', 20)).toEqual(['one two']);
  });
});

describe('pad', () => {
  it('pads left-aligned text on the right', () => {
    expect(pad('hi', 5, 'left')).toBe('hi   ');
  });

  it('pads right-aligned text on the left', () => {
    expect(pad('hi', 5, 'right')).toBe('   hi');
  });

  it('centers text, favoring the left side on an odd remainder', () => {
    expect(pad('hi', 5, 'center')).toBe(' hi  ');
  });

  it('returns text unchanged when it is already at or past width', () => {
    expect(pad('hello world', 5, 'left')).toBe('hello world');
  });

  it('measures colored text by display width, not raw length', () => {
    const colored = colorize('hi', RED, '16');
    const padded = pad(colored, 5, 'left');
    expect(measure(padded)).toBe(5);
  });
});

describe('indentBlock', () => {
  it('prefixes every line', () => {
    expect(indentBlock('a\nb\nc', '> ')).toBe('> a\n> b\n> c');
  });
});

describe('columns', () => {
  it('places blocks side by side with a gutter, top-aligned', () => {
    expect(columns(['a\nb', 'x'], [3, 3], 1)).toBe('a   x\nb');
  });

  it('leaves no trailing whitespace: the last column is not padded out', () => {
    for (const line of columns(['a\nbb', 'x'], [4, 4], 2).split('\n')) {
      expect(line).toBe(line.replace(/[ ]+$/, ''));
    }
  });
});

describe('frame', () => {
  it('draws a solid box at the exact requested width', () => {
    const box = frame('hi', { style: 'solid', width: 8 });
    const lines = box.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(measure(line)).toBe(8);
    expect(lines[0]?.startsWith('┌')).toBe(true);
    expect(lines[0]?.endsWith('┐')).toBe(true);
    expect(lines[2]?.startsWith('└')).toBe(true);
  });

  it('draws a dashed box with the dashed glyph set', () => {
    const box = frame('hi', { style: 'dashed', width: 8 });
    expect(box).toContain('╌');
    expect(box).toContain('┆');
  });

  it('weaves a title into the top edge at the exact requested width', () => {
    const box = frame('body', { style: 'solid', title: 'note', width: 12 });
    const lines = box.split('\n');
    expect(measure(lines[0] ?? '')).toBe(12);
    expect(lines[0]).toContain('note');
  });
});

describe('rule', () => {
  it('repeats the default rule character to width', () => {
    expect(rule(5)).toBe('─────');
  });

  it('repeats a custom character to width', () => {
    expect(rule(3, '=')).toBe('===');
  });
});
