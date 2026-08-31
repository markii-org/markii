import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root, RootContent, Text } from 'mdast';
import type { TextDirective } from 'mdast-util-directive';
import type { Node, Parent } from 'unist';

/**
 * Parses Mark text into an mdast AST. CommonMark plus GitHub-Flavored
 * Markdown (`remark-gfm`: tables, task lists, strikethrough, autolinks) plus
 * optional leading YAML frontmatter (`remark-frontmatter`) plus
 * the generic directive grammar (`remark-directive`) — nothing more. GFM and
 * directives are independent micromark syntax extensions (GFM extends the
 * table / list-item / inline grammar; directives add their own `:`/`::`/`:::`
 * grammar) and compose without interference regardless of `.use()` order —
 * confirmed empirically by the conformance corpus (a document combining a
 * GFM table and a `:::` directive parses both correctly). This module is
 * component-agnostic: it has no knowledge of the registry or any component,
 * and must stay that way (directive nodes carry only a name, attributes,
 * and children; interpreting a name is the renderer's job; GFM nodes are
 * standard mdast — `table`, `listItem.checked`, `delete` — needing no
 * component/registry coupling at all).
 *
 * Frontmatter is the YAML preset only (`---` fences; the TOML `+++` form is
 * deliberately not enabled) and, per micromark's frontmatter extension, is
 * recognized ONLY as the very first construct of the document. Everywhere
 * else `---` keeps its ordinary CommonMark meaning — a thematic break, or a
 * setext heading underline — and an unterminated opening `---` degrades to
 * exactly that too, never to an error (conformance fixtures 19-23). The
 * resulting `yaml` node carries the raw block text and nothing more: this
 * module does not interpret YAML, and `@markii/core` depends on no YAML
 * library. `frontmatter.ts`'s hand-rolled accessor reads the one
 * format-defined key (`uses`) off that raw text for the simple list forms.
 */
export function parse(text: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkDirective)
    .use(remarkGfm);
  const tree = processor.parse(text);
  demoteInvalidTextDirectives(tree, text);
  return tree;
}

/**
 * `remark-directive` treats every single colon as a potential text
 * directive, with no notion of ordinary prose. That misreads a clock time
 * (`12:34`), a Bible verse (`John 3:16`), a ratio (`a:b`), or a `key:value`
 * pair as a directive, and every renderer then shows an "unknown component"
 * fallback box in the middle of an otherwise plain sentence — something a
 * casual user hits constantly and has no way to escape short of learning
 * directive syntax.
 *
 * This pass narrows recognition to directives that actually look
 * intentional: a text directive is kept only when its name starts with an
 * ASCII letter (`kbd`, not `34`) AND the colon sits at a word start — either
 * the very first character of the document, or immediately preceded by
 * something other than an ASCII letter/digit. Whitespace and punctuation
 * (`(`, `*`, `_`, `"`, `>`, a newline) all count as a word start; a letter
 * or digit does not. This is checked against the raw source text via the
 * node's own start offset (not sibling nodes), so it works across emphasis
 * boundaries too — `**:badge[x]**` keeps the directive (`*` precedes the
 * colon) while `word:kbd[x]` demotes (`d` precedes it).
 *
 * A textDirective that fails the rule is replaced with a plain `text` node
 * holding the exact original source slice, so the sentence reads exactly as
 * written. Leaf (`::`) and container (`:::`) directives are untouched: they
 * only ever occur at the start of a line, so they can't collide with prose
 * colons in the first place.
 */
function demoteInvalidTextDirectives(tree: Root, source: string): void {
  visit(tree, 'textDirective', (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    const directive = node as TextDirective;
    const position = directive.position;
    if (
      position === undefined ||
      position.start.offset === undefined ||
      position.end.offset === undefined
    ) {
      return;
    }
    if (
      isRecognizedTextDirective(directive.name, position.start.offset, source)
    ) {
      return;
    }
    const replacement: Text = {
      type: 'text',
      value: source.slice(position.start.offset, position.end.offset),
      position,
    };
    (parent as Parent).children[index] = replacement;
  });
  mergeAdjacentText(tree);
}

/** ASCII letter check for the directive-name start (`kbd`, not `34` or `1st`). */
const STARTS_WITH_LETTER = /^[A-Za-z]/;
/** ASCII letter-or-digit check for the character immediately before the colon. */
const IS_WORD_CHARACTER = /[A-Za-z0-9]/;

function isRecognizedTextDirective(
  name: string,
  colonOffset: number,
  source: string,
): boolean {
  if (!STARTS_WITH_LETTER.test(name)) return false;
  if (colonOffset === 0) return true;
  const charBefore = source[colonOffset - 1];
  return charBefore === undefined || !IS_WORD_CHARACTER.test(charBefore);
}

/**
 * Merges runs of adjacent `text` sibling nodes back into one, in place,
 * recursively over the whole tree. Needed after `demoteInvalidTextDirectives`
 * replaces a textDirective with a text node: the paragraph
 * `"Meet at 12:34 pm sharp."` must come back as ONE contiguous text node
 * (matching what a plain-prose paragraph looks like everywhere else in the
 * corpus), not three fragments split around where a directive used to be.
 */
function mergeAdjacentText(node: Node): void {
  if (!hasChildren(node)) return;
  const children = node.children;
  const merged: RootContent[] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.type === 'text' && child.type === 'text') {
      last.value += child.value;
      if (last.position !== undefined && child.position !== undefined) {
        last.position = { start: last.position.start, end: child.position.end };
      }
    } else {
      merged.push(child);
    }
  }
  node.children = merged;
  for (const child of merged) mergeAdjacentText(child);
}

function hasChildren(node: Node): node is Parent & { children: RootContent[] } {
  return Array.isArray((node as { children?: unknown }).children);
}
