import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { loadCorpusCases, stripPositions } from './corpus';

/**
 * Runs the language-agnostic conformance corpus (repo-root `conformance/`)
 * against this package's own `parse()`. Any implementation — ours or a
 * third party's — is expected to reproduce the same position-free AST for
 * each `*.smd` / `*.json` pair (see DESIGN.md §13).
 */
describe('conformance corpus', () => {
  const cases = loadCorpusCases();

  it('finds at least one corpus case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))(
    '%s matches its expected AST',
    (_name, testCase) => {
      const actual = stripPositions(parse(testCase.input));
      expect(actual).toEqual(testCase.expected);
    },
  );
});
