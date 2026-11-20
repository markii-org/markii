import { describe, expect, it } from 'vitest';
import { noteFindings, standardCheckCatalog } from './note-check-behavior.js';

const unsafe = (text: string) =>
  noteFindings(text, standardCheckCatalog()).filter(
    (event) => event.kind === 'unsafe-url',
  );

describe('noteFindings with Markdown URLs', () => {
  it('flags a refused scheme on an image, a link, an autolink and a definition', () => {
    const text = [
      '![a](javascript:alert(1))',
      '',
      '[b](javascript:alert(1))',
      '',
      '<javascript:alert(1)>',
      '',
      '[c][ref]',
      '',
      '[ref]: javascript:alert(1)',
      '',
    ].join('\n');
    const messages = unsafe(text).map((event) => event.message);
    expect(messages).toContain(
      'image: source uses a scheme that is not allowed',
    );
    expect(
      messages.filter((m) => m.startsWith('link:')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('applies the sanitizer rule to mixed case and whitespace', () => {
    expect(unsafe('[x](JaVaScRiPt:alert(1))')).toHaveLength(1);
    expect(unsafe('[x](<java&#x09;script:alert(1)>)')).toHaveLength(1);
    expect(unsafe('[x](vbscript:run)')).toHaveLength(1);
  });

  it('is quiet for safe and relative targets', () => {
    expect(
      unsafe('[x](https://example.com) ![y](img/a.png) [z](#top)'),
    ).toEqual([]);
  });
});
