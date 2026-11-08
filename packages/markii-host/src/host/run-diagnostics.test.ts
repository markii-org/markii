import { describe, expect, it } from 'vitest';
import {
  formatRunFailureLines,
  runCrashDiagnosticLine,
  runDiagnosticLines,
} from './run-diagnostics.js';

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

describe('runDiagnosticLines', () => {
  it('writes nothing for a clean run', () => {
    expect(
      runDiagnosticLines('manual', {
        failureDetails: [],
        netDeclarationDiagnostics: [],
      }),
    ).toEqual([]);
  });

  it('writes a header and one indented line per failure, then the net mismatch lines', () => {
    expect(
      runDiagnosticLines('auto', {
        failureDetails: [
          { name: 'w', kind: 'script-error', message: 'no such field' },
        ],
        netDeclarationDiagnostics: ['declares a.example.com, scripts reach b'],
      }),
    ).toEqual([
      'auto run finished with 1 script failure(s):',
      '  w (script-error): no such field',
      'auto run: net declaration mismatch:',
      '  declares a.example.com, scripts reach b',
    ]);
  });

  it('words a run that threw', () => {
    expect(runCrashDiagnosticLine('manual', 'boom')).toBe(
      'manual run failed before it could report: boom',
    );
  });
});
