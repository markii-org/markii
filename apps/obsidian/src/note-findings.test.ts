import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import {
  createNoteFindingsReporter,
  noteFindingLines,
} from './note-findings.js';

const finding = (line: number, message: string): DiagnosticEvent => ({
  kind: 'unsafe-url',
  message,
  position: { startLine: line, startColumn: 1, endLine: line, endColumn: 5 },
});

describe('noteFindingLines', () => {
  it('writes one line per finding with its line number', () => {
    expect(
      noteFindingLines('a.mk.md', [
        finding(3, 'link: not allowed'),
        { kind: 'unknown-directive', message: 'unknown component' },
      ]),
    ).toEqual(['a.mk.md:3: link: not allowed', 'a.mk.md: unknown component']);
  });
});

describe('createNoteFindingsReporter', () => {
  it('writes a note again only when its findings changed', () => {
    const lines: string[] = [];
    const reporter = createNoteFindingsReporter((line) => lines.push(line));
    reporter.report('a.mk.md', [finding(1, 'x')]);
    reporter.report('a.mk.md', [finding(1, 'x')]);
    expect(lines).toEqual(['a.mk.md:1: x']);
    reporter.report('a.mk.md', [finding(2, 'x')]);
    expect(lines).toEqual(['a.mk.md:1: x', 'a.mk.md:2: x']);
  });

  it('writes nothing for a clean note and again after forget', () => {
    const lines: string[] = [];
    const reporter = createNoteFindingsReporter((line) => lines.push(line));
    reporter.report('a.mk.md', []);
    expect(lines).toEqual([]);
    reporter.report('a.mk.md', [finding(1, 'x')]);
    reporter.forget('a.mk.md');
    reporter.report('a.mk.md', [finding(1, 'x')]);
    expect(lines).toEqual(['a.mk.md:1: x', 'a.mk.md:1: x']);
  });
});
