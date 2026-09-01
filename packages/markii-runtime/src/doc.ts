/**
 * The note-scoped, read-only `doc` view a script sees (GitHub issue #33).
 *
 * A script block already knows its own source. It knows nothing about the
 * note it lives in, so a note that wants to collect what its author wrote
 * — every `:::prep_q` block, say, and turn them into one quiz — has no way
 * to say so. This module is the whole of that capability, and it is
 * deliberately small: a listing of the note's directives, and a read of a
 * value some EARLIER script in the same note already produced.
 *
 * Two properties make this safe enough to be tier-free (available to an
 * `'auto'`/`'scheduled'` run exactly as to a manual one):
 *
 * 1. It grants no authority. Everything reachable through it is content
 *    the note already contains and values the same run already computed.
 *    There is no host, no file, no clock and no store beyond this note.
 * 2. It is deterministic. `runDocumentScripts` runs a note's scripts
 *    sequentially in document order, so "the scripts above me have
 *    finished and the ones below me have not" is a fact, not a race.
 *
 * Everything here is pure: no I/O, no engine, no knowledge of Lua. A
 * concrete `ScriptExecutor` (`@markii/lua`) receives a `DocView` per
 * script and decides how to present it in its own language.
 */

/** Which of the three directive forms (docs/format.md) a listed directive was written in. */
export type DirectiveForm = 'leaf' | 'container' | 'inline';

/**
 * One directive as a script sees it. Every field is plain, already-capped
 * data — a script can copy it, return it, or ignore it, and nothing here
 * is a live handle back into the note.
 *
 * `text` is the directive's own inner text with markdown stripped: the
 * text nodes of its subtree, blocks separated by a newline. A container
 * that holds another directive therefore includes that inner directive's
 * text too, because that text is genuinely inside it; the inner directive
 * still gets its own entry in the listing.
 */
export interface DirectiveEntry {
  readonly name: string;
  readonly form: DirectiveForm;
  /** The directive's attributes, values as written. A bare attribute reads as an empty string. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
}

/**
 * A note's directives in document order, plus whether anything was left
 * out to stay inside the caps. `truncated` covers every kind of shortfall
 * — a dropped directive, a shortened text, dropped attributes — because a
 * script that cares only ever wants the one answer: is this the whole
 * note, or not?
 */
export interface DirectiveListing {
  readonly directives: readonly DirectiveEntry[];
  readonly truncated: boolean;
}

/**
 * The size budget for one note's listing. These are not security
 * boundaries in the sandbox's sense (the content is the user's own note,
 * not a remote response); they exist so a pathological note cannot turn
 * one `doc.directives()` call into a multi-megabyte string crossing the
 * isolate boundary, and so the cost of the listing is knowable in advance.
 */
export interface DocListingLimits {
  /** Total budget for the serialized listing. Directives past it are dropped. */
  readonly maxTotalBytes: number;
  /** Most directives listed, whatever their size. */
  readonly maxDirectives: number;
  /** Longest `text` per directive; a longer one is cut, never dropped. */
  readonly maxTextBytes: number;
  /** Most attributes kept per directive, in written order. */
  readonly maxAttributes: number;
  /** Longest attribute name kept. A longer one is dropped, since a cut name is a name nobody asked for. */
  readonly maxAttributeNameBytes: number;
  /** Longest attribute value kept; a longer one is cut. */
  readonly maxAttributeValueBytes: number;
  /** How deep the tree walk goes. Content nested deeper than this is not listed. */
  readonly maxDepth: number;
}

/**
 * The documented defaults. 512 KiB is the headline number: comfortably
 * more than any hand-written note holds, and small enough that the worst
 * case is a string, not a memory problem. The rest follow from it — a
 * note with two thousand directives or an eight-kilobyte question is
 * already past what the feature is for.
 */
export const DEFAULT_DOC_LISTING_LIMITS: DocListingLimits = {
  maxTotalBytes: 512 * 1024,
  maxDirectives: 2_000,
  maxTextBytes: 8 * 1024,
  maxAttributes: 32,
  maxAttributeNameBytes: 128,
  maxAttributeValueBytes: 1024,
  maxDepth: 200,
};

/** An empty listing, for a run whose host built none. Frozen: it is shared by every such run. */
export const EMPTY_DIRECTIVE_LISTING: DirectiveListing = Object.freeze({
  directives: Object.freeze([]) as readonly DirectiveEntry[],
  truncated: false,
});

/**
 * The shape `buildDirectiveListing` walks. Deliberately structural rather
 * than an mdast import: this package parses nothing, and an mdast `Root`
 * satisfies this as-is. Every read below is guarded anyway, so a foreign
 * or hand-built tree degrades to a shorter listing instead of throwing.
 */
export interface DocumentTreeNode {
  readonly type: string;
  readonly children?: readonly DocumentTreeNode[];
  /** `unknown` on purpose: mdast spells `value`, `name` and `attributes` differently across node types (an MDX element's `name` is `string | null`, its `attributes` an array), and this walk narrows every one of them at runtime anyway. */
  readonly value?: unknown;
  readonly name?: unknown;
  readonly attributes?: unknown;
}

const FORM_BY_TYPE: ReadonlyMap<string, DirectiveForm> = new Map([
  ['leafDirective', 'leaf'],
  ['containerDirective', 'container'],
  ['textDirective', 'inline'],
]);

/**
 * Node types that start a new line in the extracted text. Everything else
 * is phrasing content and runs on, so `**bold** words` reads back as
 * `bold words` rather than as two lines.
 */
const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'code',
  'table',
  'tableRow',
  'thematicBreak',
  'definition',
  'footnoteDefinition',
  'html',
  'yaml',
  'toml',
  'leafDirective',
  'containerDirective',
]);

/** Node types whose `value` IS their text. A `code` fence contributes its body; an `html` node contributes nothing, since raw markup is not text the author wrote to be read. */
const VALUE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'inlineCode',
  'code',
]);

/** Bytes `text` occupies as UTF-8, without allocating an encoder or a buffer. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A well-formed surrogate pair is one 4-byte character; a lone high
      // surrogate is replaced (see `sanitizeText`) and so costs 3.
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Removes what must never reach a script's string: C0 control characters
 * other than tab and newline, DEL, and unpaired surrogates.
 *
 * The NUL byte is the one with teeth. A Lua string is byte-clean, but the
 * JS-to-Lua marshaling in the reference engine truncates a string at its
 * first NUL (documented in `@markii/lua`'s `bytesToLuaString`), so a
 * single NUL pasted into a note would silently cut the rest of the
 * listing off. Dropping it here means one directive loses one invisible
 * character instead.
 *
 * An unpaired surrogate becomes U+FFFD for the same class of reason: it
 * cannot be encoded as UTF-8, so every layer below would have to invent
 * its own repair.
 */
export function sanitizeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i++;
      } else {
        out += '\uFFFD';
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
      continue;
    }
    if (code === 0x09 || code === 0x0a) {
      out += text[i]!;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    out += text[i]!;
  }
  return out;
}

/** Cuts `text` to at most `maxBytes` UTF-8 bytes, never mid-character. */
function truncateToBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = utf8ByteLength(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return { text: text.slice(0, end), truncated: true };
}

/** Whether `value` is a walkable node — a plain object carrying a string `type`. */
function isNode(value: unknown): value is DocumentTreeNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/** Children of `node` that are themselves nodes, or an empty array. */
function childrenOf(node: DocumentTreeNode): readonly DocumentTreeNode[] {
  const children = node.children;
  return Array.isArray(children) ? children.filter(isNode) : [];
}

/**
 * The plain text of `node`'s subtree: text and inline code as written,
 * fenced code as its body, blocks separated by a newline. Emphasis,
 * links and images contribute their text and nothing else, which is the
 * point — a script asking for a question's answer wants the answer, not
 * its markup.
 */
function collectText(
  node: DocumentTreeNode,
  depth: number,
  max: number,
): string {
  if (depth > max) return '';
  if (VALUE_TYPES.has(node.type) && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'break') return '\n';
  let out = '';
  for (const child of childrenOf(node)) {
    const part = collectText(child, depth + 1, max);
    if (part === '') continue;
    if (out !== '' && BLOCK_TYPES.has(child.type)) out += '\n';
    out += part;
  }
  return out;
}

/**
 * Reads a directive node's attributes into plain strings. A bare
 * attribute (`{open}`) arrives as `null` from the parser and reads as an
 * empty string, matching how the renderers already treat it.
 *
 * The result has a null prototype and is built with own-key assignment
 * only, so an attribute literally named `__proto__` or `constructor` is
 * an ordinary entry with no inherited meaning.
 */
function readAttributes(
  node: DocumentTreeNode,
  limits: DocListingLimits,
): { attributes: Record<string, string>; truncated: boolean } {
  const attributes = Object.create(null) as Record<string, string>;
  const raw = node.attributes;
  // A plain object only: an mdast-flavored node whose `attributes` is an
  // array (MDX) has no attributes in this format's sense, and reading one
  // as a record would list `length` as if the author had written it.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { attributes, truncated: false };
  }
  const record = raw as Record<string, unknown>;

  let truncated = false;
  let kept = 0;
  for (const key of Object.keys(record)) {
    if (kept >= limits.maxAttributes) {
      truncated = true;
      break;
    }
    const name = sanitizeText(key);
    if (name === '' || utf8ByteLength(name) > limits.maxAttributeNameBytes) {
      truncated = true;
      continue;
    }
    const rawValue = record[key];
    const value = typeof rawValue === 'string' ? sanitizeText(rawValue) : '';
    const capped = truncateToBytes(value, limits.maxAttributeValueBytes);
    if (capped.truncated) truncated = true;
    // Plain own-key assignment onto a null-prototype object: there is no
    // inherited `__proto__` setter to trip over, so a directive written
    // `{__proto__=x}` lands as an ordinary key with no side effect.
    attributes[name] = capped.text;
    kept++;
  }
  return { attributes, truncated };
}

/**
 * Walks a parsed note and returns every directive in it, in document
 * order, as plain capped data.
 *
 * Nesting is flattened deliberately: a directive written inside another
 * appears in the list right after its parent, at the position it occupies
 * in the note. A script filtering by name therefore finds every match
 * regardless of what wraps it, which is what a note author means by "all
 * my questions".
 *
 * Never throws. A tree that is not a tree, a directive with no name, an
 * `attributes` that is an array — each degrades to less listing, never to
 * an exception, because this runs inside a run whose failure surface
 * belongs to the script, not to the walk.
 */
export function buildDirectiveListing(
  tree: DocumentTreeNode | null | undefined,
  overrides: Partial<DocListingLimits> = {},
): DirectiveListing {
  const limits: DocListingLimits = {
    ...DEFAULT_DOC_LISTING_LIMITS,
    ...overrides,
  };
  const directives: DirectiveEntry[] = [];
  let truncated = false;
  let bytes = 0;

  if (!isNode(tree)) return { directives, truncated };

  const walk = (node: DocumentTreeNode, depth: number): void => {
    if (depth > limits.maxDepth) {
      truncated = true;
      return;
    }
    const form = FORM_BY_TYPE.get(node.type);
    if (form !== undefined) {
      const name = typeof node.name === 'string' ? sanitizeText(node.name) : '';
      if (name !== '') {
        if (directives.length >= limits.maxDirectives) {
          truncated = true;
        } else {
          const attrs = readAttributes(node, limits);
          if (attrs.truncated) truncated = true;
          const rawText = sanitizeText(collectText(node, 0, limits.maxDepth));
          const text = truncateToBytes(rawText, limits.maxTextBytes);
          if (text.truncated) truncated = true;
          const entry: DirectiveEntry = {
            name,
            form,
            attributes: attrs.attributes,
            text: text.text,
          };
          // Charged against the total budget by what the entry actually
          // costs on the wire, so one enormous directive cannot crowd out
          // the rest by accident and a note of small ones is not cut
          // early by a pessimistic estimate.
          const cost = entryCost(entry);
          if (bytes + cost > limits.maxTotalBytes) {
            truncated = true;
          } else {
            bytes += cost;
            directives.push(entry);
          }
        }
      }
    }
    for (const child of childrenOf(node)) walk(child, depth + 1);
  };

  walk(tree, 0);
  return { directives, truncated };
}

/** What one entry costs against `maxTotalBytes`: its text, its attribute names and values, and its own name. */
function entryCost(entry: DirectiveEntry): number {
  let cost = utf8ByteLength(entry.name) + utf8ByteLength(entry.text) + 32;
  for (const [key, value] of Object.entries(entry.attributes)) {
    cost += utf8ByteLength(key) + utf8ByteLength(value) + 8;
  }
  return cost;
}

/** A successful `doc.value` read. `value` is `undefined` for a name nothing produced. */
export interface DocValueSuccess {
  readonly ok: true;
  readonly value: unknown;
}

/** A refused `doc.value` read: the name belongs to a script that has not run yet. */
export interface DocValueRejection {
  readonly ok: false;
  readonly message: string;
}

export type DocValueRead = DocValueSuccess | DocValueRejection;

/**
 * What one script sees of its note. Handed to the executor per script;
 * never shared between two of them.
 */
export interface DocView {
  readonly directives: DirectiveListing;
  /** Reads the value of the script named `name`. Never throws — a refusal is a returned rejection. */
  value(name: string): DocValueRead;
}

/** The listing half of `runDocumentScripts`' `doc` option: what the host built from the parsed note. */
export interface DocumentContext {
  readonly directives: DirectiveListing;
}

/**
 * The ONE wording for reading a value from a script that runs later in
 * the note. It is a script-authoring mistake, not a permission problem
 * and not a resource problem, so it classifies as an ordinary script
 * error and the marker a host shows reads, in full: "script error: reads
 * "quiz", which runs later in the note".
 *
 * Keeping the sentence here means the presentation layers keep their one
 * job (naming the KIND of failure) and this package keeps its own (saying
 * what happened), instead of a phrase being invented once per host.
 */
export function laterScriptReadMessage(name: string): string {
  return `reads "${name}", which runs later in the note`;
}

/** Per-script `DocView`s for one run, plus the recorder that advances "what has finished". */
export interface DocViewSource {
  /** The view the script at `index` (document order) runs with. */
  viewFor(index: number): DocView;
  /** Records that the script at that index finished, with the value it stored (`undefined` when it failed). */
  recordCompleted(name: string, value: unknown): void;
}

/**
 * Builds the per-script views for one run.
 *
 * The rule `doc.value` enforces is "above me, already finished":
 *
 * - a name some earlier script in this run already produced reads back as
 *   that value (a script that FAILED produced nothing, so its name reads
 *   as nil — the failure is already reported against that script, and
 *   repeating it here would blame the reader);
 * - a name belonging to a script at or after the caller's own position is
 *   refused, because the answer would otherwise depend on where the
 *   reader happened to be written;
 * - anything else is simply nil, the same as reading an undefined name.
 *
 * A name written twice in one note is decided by what has already run: if
 * an earlier block of that name finished, its value is what the reader
 * sees, even when a later block will overwrite it afterwards.
 */
export function createDocViewSource(options: {
  directives: DirectiveListing;
  scriptNames: readonly string[];
}): DocViewSource {
  const { directives, scriptNames } = options;
  // Maps, not objects: a script named `__proto__` or `constructor` is a
  // legal name (`@markii/core`'s charset allows it) and must be an
  // ordinary key here, never a reach into a prototype.
  const completed = new Map<string, unknown>();
  const lastIndexByName = new Map<string, number>();
  scriptNames.forEach((name, index) => {
    lastIndexByName.set(name, index);
  });

  return {
    viewFor(index: number): DocView {
      return {
        directives,
        value(name: string): DocValueRead {
          if (typeof name !== 'string') return { ok: true, value: undefined };
          if (completed.has(name)) {
            return { ok: true, value: completed.get(name) };
          }
          const last = lastIndexByName.get(name);
          if (last !== undefined && last >= index) {
            return { ok: false, message: laterScriptReadMessage(name) };
          }
          return { ok: true, value: undefined };
        },
      };
    },
    recordCompleted(name: string, value: unknown): void {
      completed.set(name, value);
    },
  };
}
