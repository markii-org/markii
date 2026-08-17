import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

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
  return processor.parse(text);
}
