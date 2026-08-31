import { describe, expect, it } from 'vitest';
import {
  clampColumn,
  findDirectiveNameTokenAt,
  parseCompletionContext,
} from './directive-context.js';

describe('clampColumn', () => {
  it('clamps a negative column to 0', () => {
    expect(clampColumn('abc', -5)).toBe(0);
  });

  it('clamps a column past the end of the line to the line length', () => {
    expect(clampColumn('abc', 99)).toBe(3);
  });

  it('handles a non-finite column', () => {
    expect(clampColumn('abc', Number.NaN)).toBe(0);
  });

  it('handles an empty line', () => {
    expect(clampColumn('', 5)).toBe(0);
  });
});

describe('parseCompletionContext — directive-name, block form', () => {
  it('fires with zero name characters typed for a leaf opener', () => {
    const ctx = parseCompletionContext('::', 2);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('leaf');
    expect(ctx.colonRun).toBe('::');
    expect(ctx.replaceStart).toBe(0);
    expect(ctx.replaceEnd).toBe(2);
    expect(ctx.partial).toBe('');
  });

  it('fires for a container opener (three colons)', () => {
    const ctx = parseCompletionContext(':::cal', 6);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('container');
    expect(ctx.colonRun).toBe(':::');
    expect(ctx.partial).toBe('cal');
  });

  it('fires for a four-colon fence (nesting) as container form', () => {
    const ctx = parseCompletionContext('::::tabs', 8);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('container');
    expect(ctx.colonRun).toBe('::::');
  });

  it('requires the colon run to sit at the line start (ignoring leading whitespace)', () => {
    const ctx = parseCompletionContext('  ::cal', 7);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.replaceStart).toBe(2);
  });

  it('does not fire for a block form preceded by non-whitespace text', () => {
    const ctx = parseCompletionContext('x ::cal', 7);
    expect(ctx.kind).toBe('none');
  });

  it('extends replaceEnd over the rest of an identifier typed after the cursor', () => {
    const ctx = parseCompletionContext('::call out{}', 4); // cursor mid "call"
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.replaceEnd).toBe(6); // extends to the end of "call"
  });
});

describe('parseCompletionContext — directive-name, inline form', () => {
  it('requires at least one typed name character', () => {
    const ctx = parseCompletionContext('press :', 7);
    expect(ctx.kind).toBe('none');
  });

  it('fires for a single colon at line start with a typed name', () => {
    const ctx = parseCompletionContext(':kb', 3);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('inline');
    expect(ctx.colonRun).toBe(':');
    expect(ctx.partial).toBe('kb');
    expect(ctx.replaceStart).toBe(0);
  });

  it('fires for a single colon preceded by whitespace', () => {
    const ctx = parseCompletionContext('Press :kb', 9);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('inline');
    expect(ctx.replaceStart).toBe(6);
  });

  it('does not fire when the colon is not at line start or after whitespace', () => {
    const ctx = parseCompletionContext('a:kb', 4);
    expect(ctx.kind).toBe('none');
  });

  it('does not treat a colon inside a longer run as an inline opener', () => {
    // "::kb" — the last colon is not preceded by whitespace/start, it's
    // preceded by another colon, so inline detection must not fire; the
    // block detector (zero-name-chars not applicable here since "kb" is
    // typed) also does not match "::kb" against ^(\s*)(:{2,})([...]*)$
    // only when name chars are present, which they are, so it SHOULD
    // fire as a block (leaf) context instead.
    const ctx = parseCompletionContext('::kb', 4);
    expect(ctx.kind).toBe('directive-name');
    if (ctx.kind !== 'directive-name') return;
    expect(ctx.form).toBe('leaf');
  });

  it('a stray colon in prose with no whitespace before it does not fire on every space', () => {
    const ctx = parseCompletionContext('time: 5pm', 6);
    expect(ctx.kind).toBe('none');
  });
});

describe('parseCompletionContext — attribute-name', () => {
  it('fires right after the opening brace with an empty partial', () => {
    const ctx = parseCompletionContext('::callout{', 10);
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.directiveName).toBe('callout');
    expect(ctx.form).toBe('leaf');
    expect(ctx.partial).toBe('');
    expect(ctx.replaceStart).toBe(10);
    expect(ctx.replaceEnd).toBe(10);
  });

  it('fires for a partial attribute name after whitespace', () => {
    const ctx = parseCompletionContext('::callout{type=warning tit', 27);
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.partial).toBe('tit');
    expect(ctx.presentNames).toEqual(new Set(['type']));
  });

  it('excludes the partial being typed from presentNames', () => {
    const ctx = parseCompletionContext('::callout{ty', 12);
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.presentNames.has('ty')).toBe(false);
  });

  it('ignores #id and .class shorthand tokens when collecting present names', () => {
    const ctx = parseCompletionContext(
      '::callout{#my-id .my-class type=warning ',
      41,
    );
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.presentNames).toEqual(new Set(['type']));
  });

  it('collects a bare attribute token (no value) as present', () => {
    const ctx = parseCompletionContext('::details{collapsed ', 21);
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.presentNames).toEqual(new Set(['collapsed']));
  });

  it('extends replaceEnd over remaining name characters typed after the cursor', () => {
    const ctx = parseCompletionContext('::callout{ty', 11); // cursor between t and y
    expect(ctx.kind).toBe('attribute-name');
    if (ctx.kind !== 'attribute-name') return;
    expect(ctx.replaceStart).toBe(10);
    expect(ctx.replaceEnd).toBe(12);
  });
});

describe('parseCompletionContext — attribute-value', () => {
  it('fires right after an unquoted "="', () => {
    const ctx = parseCompletionContext('::callout{type=', 15);
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.attributeName).toBe('type');
    expect(ctx.partial).toBe('');
    expect(ctx.quoteChar).toBeUndefined();
  });

  it('fires for a partial unquoted value', () => {
    const ctx = parseCompletionContext('::callout{type=warn', 20);
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.partial).toBe('warn');
    expect(ctx.replaceStart).toBe(15);
    expect(ctx.replaceEnd).toBe(19);
  });

  it('extends replaceEnd over remaining unquoted value characters after the cursor', () => {
    const ctx = parseCompletionContext('::callout{type=warning}', 17); // cursor inside "warning"
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.replaceStart).toBe(15);
    expect(ctx.replaceEnd).toBe(22); // full "warning", not into "}"
  });

  it('fires inside an open double-quoted value', () => {
    const ctx = parseCompletionContext('::figure{src="a', 16);
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.attributeName).toBe('src');
    expect(ctx.quoteChar).toBe('"');
    expect(ctx.partial).toBe('a');
  });

  it('reports hasClosingQuote true when a closing quote follows on the line', () => {
    const ctx = parseCompletionContext('::figure{src="ab"}', 15); // cursor after "a"
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.hasClosingQuote).toBe(true);
    expect(ctx.replaceEnd).toBe(16); // up to, not past, the closing quote
  });

  it('reports hasClosingQuote false for an unterminated quote', () => {
    const ctx = parseCompletionContext('::figure{src="ab', 15);
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.hasClosingQuote).toBe(false);
    expect(ctx.replaceEnd).toBe(16); // end of line
  });

  it('fires inside a single-quoted value', () => {
    const ctx = parseCompletionContext("::figure{src='a", 16);
    expect(ctx.kind).toBe('attribute-value');
    if (ctx.kind !== 'attribute-value') return;
    expect(ctx.quoteChar).toBe("'");
  });
});

describe('parseCompletionContext — none', () => {
  it('returns none for an empty line', () => {
    expect(parseCompletionContext('', 0).kind).toBe('none');
  });

  it('returns none for a line of only colons with no matching form', () => {
    expect(parseCompletionContext(':', 0).kind).toBe('none');
  });

  it('returns none when there is a } before the { relative to the cursor', () => {
    const ctx = parseCompletionContext('::callout{type=warning} more ', 30);
    expect(ctx.kind).toBe('none');
  });

  it('returns none for an opener whose prefix does not match a directive form', () => {
    const ctx = parseCompletionContext('not a directive {', 18);
    expect(ctx.kind).toBe('none');
  });

  it('never throws for a negative column', () => {
    expect(() => parseCompletionContext('::callout{type=', -5)).not.toThrow();
  });

  it('never throws for a column past the end of the line', () => {
    expect(() => parseCompletionContext('::callout{type=', 999)).not.toThrow();
  });
});

describe('findDirectiveNameTokenAt', () => {
  it('finds a leaf directive name token containing the column', () => {
    const token = findDirectiveNameTokenAt('::callout{}', 4);
    expect(token).toMatchObject({
      name: 'callout',
      form: 'leaf',
      start: 2,
      end: 9,
    });
  });

  it('finds an inline directive name token', () => {
    const token = findDirectiveNameTokenAt('Press :kbd[Ctrl+S]', 8);
    expect(token).toMatchObject({
      name: 'kbd',
      form: 'inline',
      start: 7,
      end: 10,
    });
  });

  it('matches when the cursor abuts either end of the name', () => {
    expect(findDirectiveNameTokenAt('::callout{}', 2)?.name).toBe('callout');
    expect(findDirectiveNameTokenAt('::callout{}', 9)?.name).toBe('callout');
  });

  it('returns undefined when the column is not on any directive name', () => {
    expect(findDirectiveNameTokenAt('plain text', 3)).toBeUndefined();
  });

  it('returns undefined for a colon run not at line start (block form)', () => {
    expect(findDirectiveNameTokenAt('x ::callout{}', 5)).toBeUndefined();
  });

  it('never throws for a hostile __proto__ directive name', () => {
    expect(() => findDirectiveNameTokenAt('::__proto__{}', 4)).not.toThrow();
    expect(findDirectiveNameTokenAt('::__proto__{}', 4)?.name).toBe(
      '__proto__',
    );
  });

  it('never throws for an out-of-range column', () => {
    expect(() => findDirectiveNameTokenAt('::callout{}', 999)).not.toThrow();
    expect(() => findDirectiveNameTokenAt('::callout{}', -5)).not.toThrow();
  });

  it('returns undefined for an empty line', () => {
    expect(findDirectiveNameTokenAt('', 0)).toBeUndefined();
  });
});
