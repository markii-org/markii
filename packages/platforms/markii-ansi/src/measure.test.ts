import { describe, expect, it } from 'vitest';
import { measure, stripAnsi } from './measure.js';

describe('stripAnsi', () => {
  it('strips an SGR sequence', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips an OSC 8 hyperlink open and close', () => {
    expect(stripAnsi('\x1b]8;;http://x\x07link\x1b]8;;\x07')).toBe('link');
  });
});

describe('measure: escape stripping', () => {
  it('measures colored text by its visible width only', () => {
    expect(measure('\x1b[31mhi\x1b[0m')).toBe(2);
  });
});

describe('measure: ASCII', () => {
  it('measures plain ASCII as one column per character', () => {
    expect(measure('hello')).toBe(5);
  });
});

describe('measure: combining marks measure 0', () => {
  const cases: readonly [string, string][] = [
    ['U+0300', '̀'],
    ['U+1AB0', '᪰'],
    ['U+1DC0', '᷀'],
    ['U+20D0', '⃐'],
    ['U+FE00', '︀'],
    ['U+FE20', '︠'],
  ];
  for (const [label, char] of cases) {
    it(`${label} contributes 0 width after a base character`, () => {
      expect(measure(`a${char}`)).toBe(1);
    });
  }
});

describe('measure: zero-width characters measure 0', () => {
  const cases: readonly [string, string][] = [
    ['U+200B', '​'],
    ['U+200D', '‍'],
    ['U+2060', '⁠'],
    ['U+FEFF', '﻿'],
  ];
  for (const [label, char] of cases) {
    it(`${label} measures 0`, () => {
      expect(measure(char)).toBe(0);
    });
  }
});

describe('measure: East Asian Wide / Fullwidth ranges measure 2', () => {
  const cases: readonly [string, string][] = [
    ['U+1100 (Hangul Jamo)', 'ᄀ'],
    ['U+2E80 (CJK Radical)', '⺀'],
    ['U+3041 (Hiragana)', 'ぁ'],
    ['U+3400 (CJK Ext A)', '㐀'],
    ['U+4E00 (CJK)', '一'],
    ['U+A000 (Yi)', 'ꀀ'],
    ['U+AC00 (Hangul)', '가'],
    ['U+F900 (CJK Compat)', '豈'],
    ['U+FE30 (CJK Compat Forms)', '︰'],
    ['U+FF00 (Fullwidth)', '＀'],
    ['U+FFE0 (Fullwidth Signs)', '￠'],
    ['U+20000 (CJK Ext B, surrogate pair)', '\u{20000}'],
    ['U+30000 (CJK Ext G, surrogate pair)', '\u{30000}'],
  ];
  for (const [label, char] of cases) {
    it(`${label} measures 2`, () => {
      expect(measure(char)).toBe(2);
    });
  }
});

describe('measure: common emoji ranges measure 2', () => {
  const cases: readonly [string, string][] = [
    ['U+1F300 (cyclone)', '\u{1f300}'],
    ['U+1F680 (rocket)', '\u{1f680}'],
    ['U+1F900 (supervillain)', '\u{1f900}'],
    ['U+1FA70 (ballet shoes)', '\u{1fa70}'],
  ];
  for (const [label, char] of cases) {
    it(`${label} measures 2`, () => {
      expect(measure(char)).toBe(2);
    });
  }

  it('U+2600 with a following U+FE0F variation selector measures 2', () => {
    expect(measure('☀️')).toBe(2);
  });

  it('U+2600 without a variation selector measures 1 (a dingbat with no emoji presentation requested)', () => {
    expect(measure('☀')).toBe(1);
  });
});

describe('measure: surrogate pairs count as one code point', () => {
  it('a non-wide astral character (an emoji outside the wide table) still measures by code point, not code unit', () => {
    // U+1F600 (grinning face) is in the 1F600-1F64F emoji range: one code
    // point, width 2, not width 4 (which a naive UTF-16 code-unit count
    // would produce for a surrogate pair measured twice).
    expect(measure('\u{1f600}')).toBe(2);
  });
});

describe('measure: everything else measures 1', () => {
  it('an ordinary Latin letter with diacritic composed as a single code point measures 1', () => {
    expect(measure('é')).toBe(1);
  });
});
