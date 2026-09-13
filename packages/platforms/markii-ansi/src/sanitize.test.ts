import { describe, expect, it } from 'vitest';
import {
  BLOCK_TAB_WIDTH,
  sanitizeBlockText,
  sanitizeUrlText,
  stripControlCharacters,
} from './sanitize.js';

describe('stripControlCharacters', () => {
  it('drops ESC and every other C0 control', () => {
    expect(stripControlCharacters('a\x1bb\x01c')).toBe('abc');
  });

  it('drops DEL', () => {
    expect(stripControlCharacters('a\x7fb')).toBe('ab');
  });

  it('drops C1 controls, including the C1 CSI', () => {
    expect(stripControlCharacters('a\x9bb\x85c')).toBe('abc');
  });

  it('collapses tab, CR, and LF to a single space', () => {
    expect(stripControlCharacters('a\tb\rc\nd')).toBe('a b c d');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripControlCharacters('hello world')).toBe('hello world');
  });
});

describe('sanitizeBlockText', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(sanitizeBlockText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('expands a tab to BLOCK_TAB_WIDTH spaces', () => {
    expect(sanitizeBlockText('a\tb')).toBe(`a${' '.repeat(BLOCK_TAB_WIDTH)}b`);
  });

  it('drops the ESC byte itself, plus DEL and C1 controls (the remaining bracket/digit text is inert without ESC)', () => {
    expect(sanitizeBlockText('a\x1b[31mb\x7fc\x9bd')).toBe('a[31mbcd');
    expect(sanitizeBlockText('a\x1b[31mb\x7fc\x9bd')).not.toContain('\x1b');
  });

  it('keeps line feeds', () => {
    expect(sanitizeBlockText('line1\nline2')).toBe('line1\nline2');
  });
});

describe('sanitizeUrlText', () => {
  it('drops BEL and ESC', () => {
    expect(sanitizeUrlText('http://x\x07\x1b')).toBe('http://x');
  });

  it('drops spaces', () => {
    expect(sanitizeUrlText('http://x y')).toBe('http://xy');
  });

  it('drops every C0, DEL, and C1 control', () => {
    expect(sanitizeUrlText('http://x\x01\x7f\x9b')).toBe('http://x');
  });

  it('leaves an ordinary URL untouched', () => {
    expect(sanitizeUrlText('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1',
    );
  });
});
