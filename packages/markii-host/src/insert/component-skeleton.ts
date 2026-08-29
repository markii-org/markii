/**
 * "Insert Component" (GitHub issue #17, slice 1): given a component's
 * directive form and its required attributes, produces the exact directive
 * text a host inserts at the cursor, plus where the cursor should land
 * afterward so the author's next keystroke lands somewhere useful — inside
 * the body for a component with nothing required, inside the first required
 * attribute's quotes otherwise, since that is the first thing the author
 * must fill in.
 *
 * Pure and host-neutral: no editor API, no knowledge of `vscode` or
 * `obsidian`. Both hosts turn `ComponentSkeleton.cursorOffset` into their
 * own editor's line/column (or offset) type using `offsetToLineColumn`
 * below.
 */
import type { ComponentKind } from '@markii/stdlib';

/** The text to insert, and where the cursor should land within it. */
export interface ComponentSkeleton {
  /** The exact text to insert at the cursor. */
  readonly text: string;
  /** Character offset within `text` where the cursor should land after insertion. */
  readonly cursorOffset: number;
}

/**
 * Builds the skeleton for one directive. `requiredAttributes` is the
 * contract's required attribute names, in the contract's own declared
 * order (`@markii/stdlib`'s `ComponentContract.attributes` key order) —
 * only required attributes are ever pre-filled; an optional attribute is
 * never emitted, keeping the inserted text as small as the directive can
 * legally be.
 *
 * Directive forms match docs/format.md's three spellings:
 * - `container`: `:::NAME{...}\n\n:::`
 * - `leaf`:      `::NAME{...}`
 * - `inline`:    `:NAME[...]{...}` (the `{...}` clause only appears when
 *   there are required attributes — an inline directive with none of its
 *   own is just `:NAME[]`, since `[...]` is already its content slot and a
 *   trailing empty `{}` would be pointless noise in the inserted text)
 */
export function componentSkeleton(
  directiveName: string,
  kind: ComponentKind,
  requiredAttributes: readonly string[],
): ComponentSkeleton {
  const attributesClause = attributeClause(requiredAttributes);

  if (kind === 'container') {
    if (requiredAttributes.length === 0) {
      const prefix = `:::${directiveName}{}\n`;
      return { text: `${prefix}\n:::`, cursorOffset: prefix.length };
    }
    const prefix = `:::${directiveName}${attributesClause}\n`;
    return {
      text: `${prefix}\n:::`,
      cursorOffset: firstAttributeQuoteOffset(prefix),
    };
  }

  if (kind === 'leaf') {
    if (requiredAttributes.length === 0) {
      const text = `::${directiveName}{}`;
      return { text, cursorOffset: text.length - 1 };
    }
    const text = `::${directiveName}${attributesClause}`;
    return { text, cursorOffset: firstAttributeQuoteOffset(text) };
  }

  // inline
  if (requiredAttributes.length === 0) {
    const text = `:${directiveName}[]`;
    return { text, cursorOffset: text.length - 1 };
  }
  const text = `:${directiveName}[]${attributesClause}`;
  return { text, cursorOffset: firstAttributeQuoteOffset(text) };
}

/** `{attr=""}` for one or more required attribute names, space-separated in the given order. Empty input never reaches this — callers branch on `requiredAttributes.length === 0` first. */
function attributeClause(requiredAttributes: readonly string[]): string {
  const parts = requiredAttributes.map((name) => `${name}=""`);
  return `{${parts.join(' ')}}`;
}

/**
 * The offset of the character right after the first `="` in `text` — i.e.
 * inside the first attribute's quotes. `text` is always one this module
 * just built from `attributeClause`, so `="` is always present.
 */
function firstAttributeQuoteOffset(text: string): number {
  const marker = '="';
  const index = text.indexOf(marker);
  return index + marker.length;
}

/** Zero-based line and column, both counting from 0. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/**
 * Converts a character offset within `text` into a zero-based line/column,
 * counting `\n` as the only line terminator (matching every directive
 * skeleton this module produces, which never contains `\r`). An
 * out-of-range offset (negative, or past the end of `text`) is clamped to
 * the end of `text` rather than throwing — a defensive posture matching
 * this package's other pure helpers.
 */
export function offsetToLineColumn(text: string, offset: number): LineColumn {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastNewlineEnd = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewlineEnd = i + 1;
    }
  }
  return { line, column: clamped - lastNewlineEnd };
}
