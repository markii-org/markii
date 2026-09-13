import { describe, expect, it } from 'vitest';
import { formatRunFailureLines } from './run-diagnostics.js';

describe('formatRunFailureLines', () => {
  it('writes nothing for a clean run', () => {
    expect(formatRunFailureLines([])).toEqual([]);
  });

  it('writes one line per failed script with name, kind, and reason', () => {
    expect(
      formatRunFailureLines([
        { name: 'weather', kind: 'script-error', message: 'no such field' },
        { name: 'quiz', kind: 'limit', message: 'instruction budget exceeded' },
      ]),
    ).toEqual([
      'weather (script-error): no such field',
      'quiz (limit): instruction budget exceeded',
    ]);
  });
});
