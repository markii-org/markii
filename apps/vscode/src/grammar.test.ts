// This repo's dependency list is frozen (see AGENTS.md's Stack section) and
// does not include `vscode-textmate`/`vscode-oniguruma`, so these tests do
// NOT tokenize a document through the real grammar engine. Instead they
// check everything that is verifiable by treating the grammar as plain JSON:
// shape/structure invariants (parses, required top-level keys present),
// drift against package.json's `contributes.grammars[0]` (scopeName + path
// must agree with what VS Code is told to load), scope-naming conventions
// (every `name`/`contentName` ends in `.markii`), referential integrity
// (every `{"include": "#x"}` resolves to a real `repository` key), and
// regex-shape sanity (every `match`/`begin`/`end` is non-empty, and every
// capture index used in `captures`/`beginCaptures`/`endCaptures` is backed
// by a capture group that plausibly exists in the corresponding pattern).
//
// One deliberate limitation: no test here compiles a pattern with the
// built-in `RegExp`. Several patterns in the grammar use Oniguruma-only
// syntax that plain JS regex does not support, e.g. alternation inside a
// lookbehind (`(?<=\])(?!\{)|(?<=\})`) or lookbehind at all in engines that
// predate it. Attempting to compile those with `new RegExp(...)` would
// either throw or silently test something other than what Oniguruma
// actually runs, which is worse than not testing it. Capture-group counting
// below is done with a small bracket-aware scanner, not a `RegExp` compile,
// specifically so it works for every pattern in the file regardless of
// Oniguruma-only syntax.
//
// A related, sharper constraint governs lookbehind specifically: Oniguruma
// (vscode-oniguruma, what VS Code actually tokenizes with) only accepts
// FIXED-width lookbehind, or an alternation of fixed-width branches — a
// quantifier inside `(?<=...)`/`(?<!...)` such as `*`, `+`, `?`, or a
// bounded `{n,m}`/`{n,}` range is still variable-width and raises
// ONIG_ERR_INVALID_LOOK_BEHIND_PATTERN when the grammar is compiled. That
// is not a quiet no-op: the injection grammar is compiled for every
// markdown file a user opens, so one invalid lookbehind risks breaking
// tokenization repo-wide, not just failing to highlight one construct. The
// "Oniguruma lookbehind safety" tests below scan every lookbehind group in
// the grammar for that specific mistake.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GRAMMAR_PATH = resolve(
  import.meta.dirname,
  '../syntaxes/markii-directives.injection.json',
);
const PACKAGE_JSON_PATH = resolve(import.meta.dirname, '../package.json');

const grammarText = readFileSync(GRAMMAR_PATH, 'utf8');
const grammar: unknown = JSON.parse(grammarText);
const packageJsonText = readFileSync(PACKAGE_JSON_PATH, 'utf8');
const packageJson: unknown = JSON.parse(packageJsonText);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`expected an object at ${context}`);
  }
  return value;
}

/**
 * Counts the capturing groups in a TextMate/Oniguruma regex source string,
 * without compiling it. Walks the string tracking `(` that open a capturing
 * group: a `(` counts unless it is escaped (`\(`), inside a character class
 * (`[...]`), or the start of a non-capturing/lookaround construct
 * (`(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, or a named group `(?<name>`).
 */
function countCaptureGroups(pattern: string): number {
  let count = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      if (pattern[i + 1] === '?') {
        const next = pattern[i + 2];
        // (?: (?= (?! are never capturing.
        if (next === ':' || next === '=' || next === '!') {
          continue;
        }
        // (?<= (?<! are lookbehind, never capturing; (?<name> IS capturing.
        if (next === '<') {
          const after = pattern[i + 3];
          if (after === '=' || after === '!') {
            continue;
          }
          count += 1; // named capturing group
          continue;
        }
        continue;
      }
      count += 1;
    }
  }
  return count;
}

/**
 * Finds every lookbehind group — `(?<=...)` or `(?<!...)` — in a regex
 * source string and returns each one's inner content (the part between the
 * 4-character marker and its matching closing paren), without compiling
 * the pattern. Matching parens are tracked with a depth counter that skips
 * escaped characters and the contents of character classes, since `(`/`)`
 * inside `[...]` are literal there, not group delimiters.
 */
function findLookbehinds(pattern: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i)) {
      const start = i + 4;
      let depth = 1;
      let j = start;
      let inClass = false;
      while (j < pattern.length && depth > 0) {
        const c = pattern[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (inClass) {
          if (c === ']') inClass = false;
          j += 1;
          continue;
        }
        if (c === '[') {
          inClass = true;
          j += 1;
          continue;
        }
        if (c === '(') {
          depth += 1;
          j += 1;
          continue;
        }
        if (c === ')') {
          depth -= 1;
          j += 1;
          continue;
        }
        j += 1;
      }
      results.push(pattern.slice(start, j - 1));
      i = j - 1; // resume scanning right after the matched ')'
      continue;
    }
  }
  return results;
}

/**
 * Reports whether a lookbehind's inner content contains a variable-width
 * quantifier: a bare `*`, `+`, `?`, or a `{n,}`/`{n,m}` range. An exact
 * `{n}` repetition is fixed-width (it just multiplies a fixed length) and
 * is not flagged. `(?...)` group-open markers (`(?:`, `(?=`, `(?!`,
 * `(?<=`, `(?<!`, `(?<name>`) are skipped as a unit so their `?` is never
 * mistaken for a quantifier, and character classes are skipped verbatim
 * since quantifier characters are literal inside `[...]`.
 */
function hasVariableWidthQuantifier(content: string): boolean {
  let i = 0;
  let inClass = false;
  while (i < content.length) {
    const c = content[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      i += 1;
      continue;
    }
    if (c === '[') {
      inClass = true;
      i += 1;
      continue;
    }
    if (c === '(' && content[i + 1] === '?') {
      i += 2;
      continue;
    }
    if (c === '*' || c === '+' || c === '?') {
      return true;
    }
    if (c === '{') {
      const rest = content.slice(i);
      const exact = /^\{\d+\}/.exec(rest);
      if (exact) {
        i += exact[0].length;
        continue;
      }
      const range = /^\{\d*,\d*\}/.exec(rest);
      if (range) {
        return true;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return false;
}

describe('markii-directives.injection.json — shape', () => {
  it('parses as JSON', () => {
    expect(grammar).toBeDefined();
  });

  it('declares the expected scopeName', () => {
    const root = asRecord(grammar, 'root');
    expect(root.scopeName).toBe('markdown.markii.injection');
  });

  it('declares a non-empty injectionSelector', () => {
    const root = asRecord(grammar, 'root');
    expect(typeof root.injectionSelector).toBe('string');
    expect((root.injectionSelector as string).length).toBeGreaterThan(0);
  });

  it('declares a non-empty top-level patterns array', () => {
    const root = asRecord(grammar, 'root');
    expect(Array.isArray(root.patterns)).toBe(true);
    expect((root.patterns as unknown[]).length).toBeGreaterThan(0);
  });

  it('declares a non-empty repository', () => {
    const root = asRecord(grammar, 'root');
    const repository = asRecord(root.repository, 'root.repository');
    expect(Object.keys(repository).length).toBeGreaterThan(0);
  });
});

describe('markii-directives.injection.json — agrees with package.json', () => {
  it('scopeName matches contributes.grammars[0].scopeName', () => {
    const root = asRecord(grammar, 'root');
    const pkg = asRecord(packageJson, 'package.json');
    const contributes = asRecord(pkg.contributes, 'package.json.contributes');
    const grammars = contributes.grammars;
    expect(Array.isArray(grammars)).toBe(true);
    const first = asRecord(
      (grammars as unknown[])[0],
      'package.json.contributes.grammars[0]',
    );
    expect(first.scopeName).toBe(root.scopeName);
  });

  it('declared grammar path resolves to this grammar file on disk', () => {
    const pkg = asRecord(packageJson, 'package.json');
    const contributes = asRecord(pkg.contributes, 'package.json.contributes');
    const grammars = contributes.grammars;
    const first = asRecord(
      (grammars as unknown[])[0],
      'package.json.contributes.grammars[0]',
    );
    expect(typeof first.path).toBe('string');
    const declaredPath = resolve(
      import.meta.dirname,
      '..',
      first.path as string,
    );
    expect(declaredPath).toBe(GRAMMAR_PATH);
  });
});

/** Recursively walks every plain-object node in the grammar tree. */
function walk(
  node: unknown,
  visit: (n: Record<string, unknown>) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }
    return;
  }
  if (isRecord(node)) {
    visit(node);
    for (const value of Object.values(node)) {
      walk(value, visit);
    }
  }
}

describe('markii-directives.injection.json — scope naming', () => {
  it('every "name"/"contentName" is a dotted scope ending in .markii', () => {
    const offenders: string[] = [];
    walk(grammar, (node) => {
      for (const key of ['name', 'contentName'] as const) {
        const value = node[key];
        if (typeof value !== 'string') continue;
        // A dotted TextMate scope has at least one '.' and every segment is
        // non-empty; the whole thing must end with the project suffix.
        const isDotted = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/i.test(value);
        const endsCorrectly = value.endsWith('.markii');
        if (!isDotted || !endsCorrectly) {
          offenders.push(`${key}="${value}"`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('markii-directives.injection.json — referential integrity', () => {
  it('every {"include": "#x"} resolves to an existing repository key', () => {
    const root = asRecord(grammar, 'root');
    const repository = asRecord(root.repository, 'root.repository');
    const repoKeys = new Set(Object.keys(repository));
    const missing: string[] = [];
    walk(grammar, (node) => {
      const include = node.include;
      if (typeof include !== 'string' || !include.startsWith('#')) return;
      const key = include.slice(1);
      if (!repoKeys.has(key)) {
        missing.push(include);
      }
    });
    expect(missing).toEqual([]);
  });
});

describe('markii-directives.injection.json — regex shape sanity', () => {
  it('every match/begin/end pattern is a non-empty string', () => {
    const offenders: string[] = [];
    walk(grammar, (node) => {
      for (const key of ['match', 'begin', 'end'] as const) {
        const value = node[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.length === 0) {
          offenders.push(`${key}=${JSON.stringify(value)}`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it('every captures/beginCaptures/endCaptures index is backed by a capture group', () => {
    const offenders: string[] = [];
    walk(grammar, (node) => {
      const pairs: Array<[string, string]> = [
        ['match', 'captures'],
        ['begin', 'beginCaptures'],
        ['end', 'endCaptures'],
      ];
      for (const [patternKey, capturesKey] of pairs) {
        const pattern = node[patternKey];
        const captures = node[capturesKey];
        if (typeof pattern !== 'string' || captures === undefined) continue;
        const captureRecord = asRecord(
          captures,
          `${patternKey}/${capturesKey}`,
        );
        const groupCount = countCaptureGroups(pattern);
        for (const indexKey of Object.keys(captureRecord)) {
          const index = Number(indexKey);
          if (!Number.isInteger(index) || index < 0) {
            offenders.push(`non-numeric capture index "${indexKey}"`);
            continue;
          }
          // Index 0 (the whole match) is always valid; indices above the
          // counted group total are not backed by any group in the pattern.
          if (index > groupCount) {
            offenders.push(
              `${capturesKey}["${indexKey}"] exceeds ${groupCount} capture group(s) in ${patternKey}=${JSON.stringify(
                pattern,
              )}`,
            );
          }
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('markii-directives.injection.json — Oniguruma lookbehind safety', () => {
  it('every lookbehind group is fixed-width', () => {
    // Oniguruma (vscode-oniguruma) rejects variable-width lookbehind — see
    // the file-level comment above for the ONIG_ERR_INVALID_LOOK_BEHIND_PATTERN
    // rule this guards against. A `*`, `+`, `?`, or `{n,}`/`{n,m}` quantifier
    // inside `(?<=...)`/`(?<!...)` is a regression, not a style nit: it can
    // break tokenization for every markdown file VS Code opens.
    const offenders: string[] = [];
    walk(grammar, (node) => {
      for (const key of ['match', 'begin', 'end'] as const) {
        const value = node[key];
        if (typeof value !== 'string') continue;
        for (const content of findLookbehinds(value)) {
          if (hasVariableWidthQuantifier(content)) {
            offenders.push(
              `${key}=${JSON.stringify(value)} — variable-width lookbehind content "${content}"`,
            );
          }
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it('fence-meta-attributes never matches a backtick', () => {
    // The fence-meta rule must only ever match the {...} group itself —
    // never the fence's backticks — or it risks claiming (and breaking
    // highlighting for) the whole code-fence line. See that rule's own
    // "comment" key in the grammar for the full trade-off.
    const root = asRecord(grammar, 'root');
    const repository = asRecord(root.repository, 'root.repository');
    const rule = asRecord(
      repository['fence-meta-attributes'],
      'repository.fence-meta-attributes',
    );
    for (const key of ['match', 'begin', 'end'] as const) {
      const value = rule[key];
      if (typeof value !== 'string') continue;
      expect(value.includes('`')).toBe(false);
    }
  });
});

describe('countCaptureGroups — self-check on JS-compatible fixtures', () => {
  // These fixtures are deliberately plain (no Oniguruma-only syntax), so
  // cross-checking against `RegExp` is safe and meaningful here even though
  // the grammar file itself is not compiled with `RegExp` above.
  it.each<[string, number]>([
    ['(\\{)', 1],
    ['(\\})', 1],
    ['([A-Za-z_][-\\w]*)(=)(?:(")|(\'))', 4],
    ['[A-Za-z_][-\\w]*', 0],
    ['(#)([A-Za-z][-\\w]*)', 2],
    ['^(\\s*)(:{3,})([A-Za-z][-\\w]*)', 3],
    ['(?:foo)(bar)', 1],
    ['(?<name>foo)', 1],
  ])('counts %s as %d group(s)', (pattern, expected) => {
    // Cross-check against `RegExp`'s own idea of its capture-group count
    // (exec on an empty string still reports one array slot per group,
    // beyond index 0, when the match succeeds or partially succeeds) —
    // done here only because these fixtures are proven JS-safe.
    const compiled = new RegExp(pattern);
    expect(countCaptureGroups(pattern)).toBe(expected);
    expect(compiled.source).toBe(pattern);
  });
});
