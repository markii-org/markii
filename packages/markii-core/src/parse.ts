import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

/**
 * Parses Mark text into an mdast AST. CommonMark plus GitHub-Flavored
 * Markdown (`remark-gfm`: tables, task lists, strikethrough, autolinks) plus
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
 */
export function parse(text: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkGfm);
  return processor.parse(text);
}
