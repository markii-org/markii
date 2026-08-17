import type { Root } from 'mdast';
import { parse } from './parse.js';

/**
 * A document's leading YAML frontmatter block, as far as this package cares
 * about it: the raw text between the `---` fences, plus the one
 * format-defined key (`uses`) when it is written in one of the two simple
 * list forms this module understands.
 *
 * `raw` is the block's exact source text, unparsed — a host that genuinely
 * needs arbitrary YAML metadata (its own `title`, `tags`, ...) brings its own
 * YAML parser and reads this string. `@markii/core` deliberately does not:
 * see `readUses` below.
 */
export interface Frontmatter {
  /** The raw YAML text between the `---` fences (no fences, no trailing newline). */
  raw: string;
  /**
   * Pack names from a `uses:` list written in one of the two supported
   * forms, or `undefined` when the key is absent, is written in any other
   * shape, or contains anything that is not a plain name. An empty list
   * (`uses: []`) is `[]` — "declared, and it names no packs" — which is
   * distinguishable from `undefined` ("no usable declaration").
   */
  uses?: string[];
}

/**
 * The one format-defined frontmatter key (docs/format.md, docs/packs.md), as
 * a top-level `uses:` line: the key at column 0 (so a `uses:` nested under
 * some other mapping is deliberately invisible to this reader), optional
 * spacing, then whatever follows the colon on the same line.
 */
const USES_LINE = /^uses[ \t]*:(.*)$/;

/** One block-sequence item line: `- name`, capturing its indent and value. */
const LIST_ITEM_LINE = /^([ \t]*)-[ \t]+(.*)$/;

/**
 * What a pack name may look like once quotes are stripped. Intentionally
 * narrow: alphanumerics, `-`, `_`, `.` only (docs/packs.md — a namespace is
 * a plain word, joined to a component name with `-` or `_`). Anything else —
 * whitespace, `:`, `#`, brackets, braces, commas, a stray quote — means the
 * value is not the simple scalar this reader claims to understand, so the
 * whole list degrades to `undefined` rather than being half-read.
 *
 * A name like `__proto__` or `constructor` passes, and that is deliberate:
 * this reader returns STRINGS in an array, never object keys, so a
 * prototype-flavored name is ordinary data here. The registry lookups that
 * eventually consume such a name are themselves null-prototype and
 * `Object.hasOwn`-guarded (`@markii/react`'s `registry.ts`), which is where
 * that class of defense belongs — not in a name filter that would have to
 * guess every hostile spelling.
 */
const PACK_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Reads one flow-sequence or block-sequence item: trims it, strips ONE pair
 * of matching surrounding quotes (`'a'` / `"a"` — YAML's two quoting styles,
 * used here only to unwrap a name, never to interpret escapes), and returns
 * it only if what remains is a plain pack name. Returns `undefined` for
 * anything else, including an opening quote with no matching close.
 */
function readItem(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const quote = trimmed[0];
  let value = trimmed;
  if (quote === '"' || quote === "'") {
    if (trimmed.length < 2 || !trimmed.endsWith(quote)) return undefined;
    value = trimmed.slice(1, -1);
  }

  return PACK_NAME.test(value) ? value : undefined;
}

/** Maps `readItem` over every raw item, failing the WHOLE list if any item fails. */
function readItems(rawItems: string[]): string[] | undefined {
  const values: string[] = [];
  for (const rawItem of rawItems) {
    const value = readItem(rawItem);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

/**
 * Reads the flow form — `uses: [a, b]` — from the text that follows the
 * colon. The text must be exactly a bracketed sequence: a trailing comment
 * (`uses: [a] # note`) or any other suffix is NOT this form and yields
 * `undefined`, since recognizing it would mean tokenizing YAML rather than
 * matching one fixed shape. `[]` yields the empty list.
 */
function readFlowSequence(text: string): string[] | undefined {
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  return readItems(inner.split(','));
}

/**
 * Reads the block form — a bare `uses:` followed by `- name` lines — from
 * the lines after the key. Items must be contiguous (the first line that is
 * not an item ends the sequence, blank lines included) and share one indent,
 * which is what keeps a differently-indented continuation of some richer
 * YAML structure from being mistaken for a flat list. No items, or a
 * ragged/uneven sequence, yields `undefined`.
 */
function readBlockSequence(
  lines: string[],
  start: number,
): string[] | undefined {
  const rawItems: string[] = [];
  let indent: string | undefined;

  for (const line of lines.slice(start)) {
    const match = LIST_ITEM_LINE.exec(line);
    const [, lineIndent, item] = match ?? [];
    if (lineIndent === undefined || item === undefined) break;
    if (indent === undefined) indent = lineIndent;
    else if (lineIndent !== indent) return undefined;
    rawItems.push(item);
  }

  return rawItems.length > 0 ? readItems(rawItems) : undefined;
}

/**
 * The hand-rolled `uses:` reader — the whole reason `@markii/core` needs no
 * YAML library, exactly as `@markii/bundle`'s `manifest.ts` needs no schema
 * library. It recognizes TWO shapes and nothing else:
 *
 * ```yaml
 * uses: [ana, gh]      # flow sequence
 * uses:                # block sequence
 *   - ana
 *   - gh
 * ```
 *
 * quotes and surrounding whitespace tolerated in both. Every other input —
 * a `uses:` holding a scalar or a nested mapping, a duplicated `uses:` key,
 * an indented (non-top-level) `uses:`, a value this reader cannot recognize,
 * or frontmatter that is not valid YAML at all — returns `undefined`. It
 * NEVER throws and never returns a partially-read list: `uses` is an
 * informative hint (docs/packs.md — "this note uses pack `ana`, which is not
 * installed"), so "I could not read this" and "there is nothing here" are
 * the same, harmless answer, while a half-read list would produce a wrong
 * warning about packs the note never named.
 */
function readUses(raw: string): string[] | undefined {
  const lines = raw.split(/\r?\n/);

  let keyIndex = -1;
  let rest = '';
  for (const [index, line] of lines.entries()) {
    const [, value] = USES_LINE.exec(line) ?? [];
    if (value === undefined) continue;
    // A second top-level `uses:` makes the document ambiguous (YAML itself
    // rejects duplicate keys); refuse to guess which one was meant.
    if (keyIndex !== -1) return undefined;
    keyIndex = index;
    rest = value;
  }
  if (keyIndex === -1) return undefined;

  const inline = rest.trim();
  return inline === ''
    ? readBlockSequence(lines, keyIndex + 1)
    : readFlowSequence(inline);
}

/**
 * The document's leading YAML frontmatter, or `undefined` when it has none.
 *
 * Accepts either the source text or an already-parsed tree, so a caller that
 * has parsed the document already (the common case for a renderer) pays no
 * second parse. Recognition is the PARSER's, not this module's: frontmatter
 * is whatever `parse` produced as a leading `yaml` node, so the accessor and
 * the renderer can never disagree about whether a `---` block at the top of
 * a file was metadata or a thematic break.
 *
 * Never throws — `uses` simply degrades to `undefined` for anything beyond
 * the two list forms `readUses` documents. A tree that did not come from
 * this package's `parse` (a host that transforms the AST, or hand-builds
 * one) is treated the same way: a leading node that merely CLAIMS to be
 * `yaml` without carrying string content is no frontmatter at all, rather
 * than a `raw.split` on a number.
 */
export function extractFrontmatter(
  source: string | Root,
): Frontmatter | undefined {
  const tree = typeof source === 'string' ? parse(source) : source;
  const first: { type: string; value?: unknown } | undefined = tree.children[0];
  if (first?.type !== 'yaml' || typeof first.value !== 'string') {
    return undefined;
  }

  const raw = first.value;
  const uses = readUses(raw);
  return uses === undefined ? { raw } : { raw, uses };
}

/**
 * Convenience wrapper over `extractFrontmatter`: just the `uses` list, or
 * `undefined` when the document has no frontmatter, no `uses:` key, or a
 * `uses:` value outside the two supported list forms. `uses` semantics
 * (surfacing "pack not installed" in a host's UI) live with the host — this
 * is only the reader.
 */
export function extractFrontmatterUses(
  source: string | Root,
): string[] | undefined {
  return extractFrontmatter(source)?.uses;
}
