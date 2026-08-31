/**
 * Directive autocompletion (GitHub issue #27, slice 1): the pure line/column
 * parser that decides WHAT kind of thing sits at the cursor — a directive
 * name being typed, an attribute name, or an attribute value — and WHERE
 * the accepted completion's text would replace. No knowledge of the insert
 * catalog or `@markii/stdlib` contracts lives here; this module only reads
 * characters. `./completion.ts` turns what this module finds into the
 * actual `CompletionItem[]`.
 *
 * Every exported function is defensive: an out-of-range or negative
 * `column`, an empty line, an unterminated brace, and an unterminated quote
 * all produce a sensible "nothing here" result rather than throwing.
 */
import type { ComponentKind } from '@markii/stdlib';

/** Which of the three directive forms the text around the cursor is written as. Matches `ComponentKind`'s three values one-to-one. */
export type DirectiveForm = ComponentKind;

const NAME_CHAR = /[A-Za-z0-9_-]/;

/** Attribute names already present in the brace clause, lowercased, minus the partial name currently being typed. */
export interface AttributeNameParseResult {
  readonly kind: 'attribute-name';
  readonly directiveName: string;
  readonly form: DirectiveForm;
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly partial: string;
  readonly presentNames: ReadonlySet<string>;
}

export interface AttributeValueParseResult {
  readonly kind: 'attribute-value';
  readonly directiveName: string;
  readonly form: DirectiveForm;
  readonly attributeName: string;
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly partial: string;
  /** The quote character the value was opened with, or `undefined` for an unquoted value. */
  readonly quoteChar: '"' | "'" | undefined;
  /** True when a closing quote matching `quoteChar` already sits after the replace range. Always `false` when `quoteChar` is `undefined`. */
  readonly hasClosingQuote: boolean;
}

export interface DirectiveNameParseResult {
  readonly kind: 'directive-name';
  readonly form: DirectiveForm;
  /** The colon run exactly as typed (e.g. `':'`, `'::'`, `'::::'`). */
  readonly colonRun: string;
  /** Start of the colon run. */
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly partial: string;
}

export type ParsedCompletionContext =
  | AttributeNameParseResult
  | AttributeValueParseResult
  | DirectiveNameParseResult
  | { readonly kind: 'none' };

/**
 * Clamps a possibly-hostile column (negative, non-finite, past the end of
 * the line) into `[0, line.length]`.
 */
export function clampColumn(line: string, column: number): number {
  const safeLine = typeof line === 'string' ? line : '';
  const safeColumn = Number.isFinite(column) ? column : 0;
  return Math.max(0, Math.min(safeColumn, safeLine.length));
}

/**
 * The last `{` at an index below `column` with no `}` between it and
 * `column`, or `undefined` if the nearest unmatched-looking brace character
 * going backward is a `}` (the braces are already closed here) or there is
 * no `{` at all.
 */
function findOpenBrace(line: string, column: number): number | undefined {
  for (let i = column - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === '}') return undefined;
    if (ch === '{') return i;
  }
  return undefined;
}

/** Extends forward from `from` over identifier characters, stopping at the first non-identifier character or end of line. */
function extendOverIdentifier(line: string, from: number): number {
  let end = from;
  while (end < line.length && NAME_CHAR.test(line[end]!)) end++;
  return end;
}

interface AttributeOpener {
  readonly form: DirectiveForm;
  readonly directiveName: string;
  readonly braceIndex: number;
}

const OPENER_RE = /(:{1,})([A-Za-z0-9_-]+)(\[[^\]]*\])?$/;

/**
 * Finds the directive opener a `{...}` clause belongs to: the text right
 * before the brace must end with `:name`, `::name`, or `:::name` (three or
 * more colons), positioned per docs/format.md's rules (a block form's colon
 * run sits at the line's start, ignoring leading whitespace; the inline
 * form's single colon sits at the line's start or after whitespace).
 * `undefined` when there is no unclosed `{` below `column`, or the text
 * before it does not look like a directive opener.
 */
function findAttributeOpener(
  line: string,
  column: number,
): AttributeOpener | undefined {
  const braceIndex = findOpenBrace(line, column);
  if (braceIndex === undefined) return undefined;

  const before = line.slice(0, braceIndex);
  const match = OPENER_RE.exec(before);
  if (match === null) return undefined;

  const colons = match[1]!;
  const name = match[2]!;
  const colonStart = match.index;

  if (colons.length >= 2) {
    if (!/^\s*$/.test(line.slice(0, colonStart))) return undefined;
  } else if (colonStart > 0 && !/\s/.test(line[colonStart - 1]!)) {
    return undefined;
  }

  const form: DirectiveForm =
    colons.length === 1 ? 'inline' : colons.length === 2 ? 'leaf' : 'container';

  return { form, directiveName: name.toLowerCase(), braceIndex };
}

/** The end of a brace clause: the first unquoted `}` after `braceIndex`, or `line.length` when the clause is never closed. */
function findClauseEnd(line: string, braceIndex: number): number {
  let quote: string | undefined;
  for (let i = braceIndex + 1; i < line.length; i++) {
    const ch = line[i]!;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '}') return i;
  }
  return line.length;
}

/** Splits `text` into whitespace-separated tokens, respecting quoted spans so a quoted value's internal whitespace never splits a token. */
function splitTopLevelTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of text) {
    if (quote !== undefined) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Attribute names already written in a brace clause (`name=` and bare `name` tokens), lowercased. Ignores `#id`/`.class` shorthand tokens. */
function presentAttributeNames(
  line: string,
  start: number,
  end: number,
): Set<string> {
  const tokens = splitTopLevelTokens(line.slice(start, end));
  const names = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith('#') || token.startsWith('.')) continue;
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    if (name.length > 0) names.add(name.toLowerCase());
  }
  return names;
}

/** The attribute name whose `=` sits at `equalsIndex`, or `undefined` if no name characters precede it. Lowercased. */
function attributeNameBeforeEquals(
  line: string,
  equalsIndex: number,
): string | undefined {
  let i = equalsIndex;
  while (i > 0 && NAME_CHAR.test(line[i - 1]!)) i--;
  if (i === equalsIndex) return undefined;
  return line.slice(i, equalsIndex).toLowerCase();
}

interface QuoteState {
  readonly quote: string | undefined;
  readonly quoteOpenIndex: number;
}

/** Whether `column` sits inside an open quote started somewhere in `[start, column)`, tracking simple (non-escaping) quote toggles. */
function quoteStateUpTo(
  line: string,
  start: number,
  column: number,
): QuoteState {
  let quote: string | undefined;
  let quoteOpenIndex = -1;
  for (let i = start; i < column; i++) {
    const ch = line[i]!;
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
        quoteOpenIndex = -1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoteOpenIndex = i;
    }
  }
  return { quote, quoteOpenIndex };
}

/** The attribute-name or attribute-value context inside an opened `{...}` clause, or `{ kind: 'none' }` when the cursor sits somewhere that context detection cannot make sense of (e.g. an unterminated quote not opened right after `=`). */
function parseInsideBraces(
  line: string,
  column: number,
  opener: AttributeOpener,
): AttributeNameParseResult | AttributeValueParseResult | { kind: 'none' } {
  const start = opener.braceIndex + 1;
  const qs = quoteStateUpTo(line, start, column);

  if (qs.quote !== undefined) {
    if (line[qs.quoteOpenIndex - 1] !== '=') return { kind: 'none' };
    const attributeName = attributeNameBeforeEquals(
      line,
      qs.quoteOpenIndex - 1,
    );
    if (attributeName === undefined) return { kind: 'none' };

    const valueStart = qs.quoteOpenIndex + 1;
    let valueEnd = column;
    while (valueEnd < line.length && line[valueEnd] !== qs.quote) valueEnd++;
    const hasClosingQuote = line[valueEnd] === qs.quote;

    return {
      kind: 'attribute-value',
      directiveName: opener.directiveName,
      form: opener.form,
      attributeName,
      replaceStart: valueStart,
      replaceEnd: valueEnd,
      partial: line.slice(valueStart, column),
      quoteChar: qs.quote as '"' | "'",
      hasClosingQuote,
    };
  }

  const beforeCursor = line.slice(start, column);
  const tokenMatch = /[A-Za-z0-9_-]*$/.exec(beforeCursor)!;
  const token = tokenMatch[0]!;
  const tokenStart = column - token.length;
  const prevChar = line[tokenStart - 1];

  if (prevChar === '=') {
    const attributeName = attributeNameBeforeEquals(line, tokenStart - 1);
    if (attributeName === undefined) return { kind: 'none' };
    const valueEnd = extendOverIdentifier(line, column);
    return {
      kind: 'attribute-value',
      directiveName: opener.directiveName,
      form: opener.form,
      attributeName,
      replaceStart: tokenStart,
      replaceEnd: valueEnd,
      partial: token,
      quoteChar: undefined,
      hasClosingQuote: false,
    };
  }

  if (prevChar === '{' || prevChar === ' ' || prevChar === '\t') {
    const clauseEnd = findClauseEnd(line, opener.braceIndex);
    const presentNames = presentAttributeNames(line, start, clauseEnd);
    presentNames.delete(token.toLowerCase());
    const nameEnd = extendOverIdentifier(line, column);
    return {
      kind: 'attribute-name',
      directiveName: opener.directiveName,
      form: opener.form,
      replaceStart: tokenStart,
      replaceEnd: nameEnd,
      partial: token,
      presentNames,
    };
  }

  return { kind: 'none' };
}

/** Parses the block-form (`::`/`:::`+) directive-name context: `^(\s*)(:{2,})([A-Za-z0-9_-]*)$` against the text up to `column`. May fire with zero name characters typed. */
function parseBlockDirectiveName(
  line: string,
  column: number,
): DirectiveNameParseResult | undefined {
  const prefix = line.slice(0, column);
  const match = /^(\s*)(:{2,})([A-Za-z0-9_-]*)$/.exec(prefix);
  if (match === null) return undefined;

  const ws = match[1]!;
  const colons = match[2]!;
  const name = match[3]!;
  const colonStart = ws.length;
  const form: DirectiveForm = colons.length === 2 ? 'leaf' : 'container';
  const nameEnd = extendOverIdentifier(line, column);

  return {
    kind: 'directive-name',
    form,
    colonRun: colons,
    replaceStart: colonStart,
    replaceEnd: nameEnd,
    partial: name,
  };
}

/** Parses the inline-form (single `:`) directive-name context. Requires at least one typed name character, and the colon must sit at the line start or after whitespace (and must not itself be part of a longer colon run). */
function parseInlineDirectiveName(
  line: string,
  column: number,
): DirectiveNameParseResult | undefined {
  let i = column;
  while (i > 0 && NAME_CHAR.test(line[i - 1]!)) i--;
  const nameStart = i;
  if (nameStart === column) return undefined; // no typed name characters
  if (nameStart === 0) return undefined; // no colon can precede
  if (line[nameStart - 1] !== ':') return undefined;

  const colonIndex = nameStart - 1;
  if (!(colonIndex === 0 || /\s/.test(line[colonIndex - 1]!))) return undefined;

  const nameEnd = extendOverIdentifier(line, column);
  return {
    kind: 'directive-name',
    form: 'inline',
    colonRun: ':',
    replaceStart: colonIndex,
    replaceEnd: nameEnd,
    partial: line.slice(nameStart, column),
  };
}

/**
 * The full context-detection algorithm: attribute contexts are checked
 * first, then the directive-name contexts, then `'none'`. `column` is
 * clamped defensively; this function never throws.
 */
export function parseCompletionContext(
  line: string,
  column: number,
): ParsedCompletionContext {
  const safeLine = typeof line === 'string' ? line : '';
  const clampedColumn = clampColumn(safeLine, column);

  const opener = findAttributeOpener(safeLine, clampedColumn);
  if (opener !== undefined) {
    return parseInsideBraces(safeLine, clampedColumn, opener);
  }

  const block = parseBlockDirectiveName(safeLine, clampedColumn);
  if (block !== undefined) return block;

  const inline = parseInlineDirectiveName(safeLine, clampedColumn);
  if (inline !== undefined) return inline;

  return { kind: 'none' };
}

/** A directive name token found anywhere on the line, for `hoverAt`. */
export interface DirectiveNameToken {
  readonly name: string;
  readonly form: DirectiveForm;
  readonly start: number;
  readonly end: number;
}

const OPENER_SCAN_RE = /(:{1,})([A-Za-z0-9_-]+)/g;

/**
 * Finds the directive-name token whose range contains or abuts `column`,
 * anywhere on the line (not only at the end of the cursor's prefix, since
 * hover targets an already-written directive). `undefined` when no valid
 * opener's name range covers `column`.
 */
export function findDirectiveNameTokenAt(
  line: string,
  column: number,
): DirectiveNameToken | undefined {
  const safeLine = typeof line === 'string' ? line : '';
  const clampedColumn = clampColumn(safeLine, column);

  OPENER_SCAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPENER_SCAN_RE.exec(safeLine)) !== null) {
    const colons = match[1]!;
    const name = match[2]!;
    const colonStart = match.index;
    const nameStart = colonStart + colons.length;
    const nameEnd = nameStart + name.length;

    const valid =
      colons.length === 1
        ? colonStart === 0 || /\s/.test(safeLine[colonStart - 1]!)
        : /^\s*$/.test(safeLine.slice(0, colonStart));

    if (valid && nameStart <= clampedColumn && clampedColumn <= nameEnd) {
      return {
        name: name.toLowerCase(),
        form:
          colons.length === 1
            ? 'inline'
            : colons.length === 2
              ? 'leaf'
              : 'container',
        start: nameStart,
        end: nameEnd,
      };
    }
  }
  return undefined;
}
