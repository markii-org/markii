import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import { noteProblems } from './note-findings.js';

describe('noteProblems', () => {
  it('converts one-based positions to zero-based ranges, as warnings', () => {
    const finding: DiagnosticEvent = {
      kind: 'unsafe-url',
      message: 'link: target uses a scheme that is not allowed',
      position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 20 },
    };
    expect(noteProblems([finding])).toEqual([
      {
        startLine: 2,
        startColumn: 0,
        endLine: 2,
        endColumn: 19,
        severity: 'warning',
        message: 'link: target uses a scheme that is not allowed',
        code: 'unsafe-url',
        source: 'markii',
      },
    ]);
  });

  it('places a finding with no position on the first line', () => {
    const [problem] = noteProblems([
      { kind: 'unknown-directive', message: 'unknown component' },
    ]);
    expect(problem).toMatchObject({
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
      severity: 'warning',
    });
  });

  it('returns nothing for a clean note', () => {
    expect(noteProblems([])).toEqual([]);
  });
});
