import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  emptyInlineTitle,
  failurePhrase,
  invalidAttributeValueTitle,
  unsafeImageSrcTitle,
} from './failure-presentation.js';

/**
 * `@markii/html`'s `failure-presentation.ts` is the wording this engine's
 * copy is required to match byte for byte (this module's own top comment).
 * Rather than import `@markii/html` (this package's dependency list is
 * exactly `@markii/core` and `@markii/stdlib`; see the batch brief), this
 * suite reads the HTML engine's source file as TEXT and extracts its
 * phrase table and title templates with regular expressions, so a wording
 * change in one engine that is not mirrored in the other fails a test
 * instead of silently drifting.
 */

const HTML_FAILURE_PRESENTATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../markii-html/src/failure-presentation.ts',
);

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced braces while scanning failure-presentation.ts');
}

/** The `FAILURE_PHRASE` table's entries, keyed by `FailureKind`, whether the source key is quoted (`'script-error'`) or a bare identifier (`limit`). */
function extractFailurePhraseTable(source: string): Record<string, string> {
  const anchor = source.indexOf('FAILURE_PHRASE: Record<string, string>');
  if (anchor === -1) {
    throw new Error('could not find the FAILURE_PHRASE declaration');
  }
  const braceStart = source.indexOf('{', anchor);
  const braceEnd = findMatchingBrace(source, braceStart);
  const body = source.slice(braceStart, braceEnd);

  const table: Record<string, string> = {};
  const pattern = /(?:'([a-z-]+)'|([a-zA-Z]+))\s*:\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const key = match[1] ?? match[2];
    const value = match[3];
    if (key && value !== undefined) table[key] = value;
  }
  return table;
}

/** The literal template text (including `${...}` placeholders) inside one exported function's `return \`...\`;` statement. */
function extractReturnTemplate(source: string, functionName: string): string {
  const anchor = source.indexOf(`export function ${functionName}(`);
  if (anchor === -1) {
    throw new Error(`could not find function ${functionName} in source`);
  }
  const braceStart = source.indexOf('{', anchor);
  const braceEnd = findMatchingBrace(source, braceStart);
  const body = source.slice(braceStart, braceEnd);
  const match = /return `([^`]*)`/.exec(body);
  if (!match?.[1]) {
    throw new Error(`could not find a template return in ${functionName}`);
  }
  return match[1];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

describe('failure-presentation drift: FAILURE_PHRASE table', () => {
  const htmlSource = readFileSync(HTML_FAILURE_PRESENTATION_PATH, 'utf8');
  const table = extractFailurePhraseTable(htmlSource);

  it('self-test: the extraction actually finds all four phrases', () => {
    expect(Object.keys(table).sort()).toEqual(
      ['capability-denied', 'limit', 'script-error', 'tier-blocked'].sort(),
    );
  });

  const kinds = [
    'script-error',
    'capability-denied',
    'tier-blocked',
    'limit',
  ] as const;

  for (const kind of kinds) {
    it(`"${kind}" phrase matches @markii/html's exactly`, () => {
      expect(failurePhrase(kind)).toBe(table[kind]);
    });
  }
});

describe('failure-presentation drift: title templates', () => {
  const htmlSource = readFileSync(HTML_FAILURE_PRESENTATION_PATH, 'utf8');

  it('self-test: the extraction actually finds the three templates', () => {
    expect(extractReturnTemplate(htmlSource, 'emptyInlineTitle')).toContain(
      'no content',
    );
    expect(
      extractReturnTemplate(htmlSource, 'invalidAttributeValueTitle'),
    ).toContain('is not a valid');
    expect(extractReturnTemplate(htmlSource, 'unsafeImageSrcTitle')).toContain(
      'refused as unsafe',
    );
  });

  it("emptyInlineTitle matches @markii/html's template", () => {
    const template = extractReturnTemplate(htmlSource, 'emptyInlineTitle');
    expect(emptyInlineTitle('badge')).toBe(
      fillTemplate(template, { name: 'badge' }),
    );
  });

  it("invalidAttributeValueTitle matches @markii/html's template", () => {
    const template = extractReturnTemplate(
      htmlSource,
      'invalidAttributeValueTitle',
    );
    expect(invalidAttributeValueTitle('callout', 'type', 'bogus')).toBe(
      fillTemplate(template, {
        directive: 'callout',
        attribute: 'type',
        value: 'bogus',
      }),
    );
  });

  it("unsafeImageSrcTitle matches @markii/html's template", () => {
    const template = extractReturnTemplate(htmlSource, 'unsafeImageSrcTitle');
    expect(unsafeImageSrcTitle('figure')).toBe(
      fillTemplate(template, { directive: 'figure' }),
    );
  });
});
