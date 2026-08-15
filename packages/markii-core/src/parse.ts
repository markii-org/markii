import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import type { Root } from 'mdast';

/**
 * Parses Super Markdown text into an mdast AST. CommonMark plus the generic
 * directive grammar (`remark-directive`) — nothing more. This module is
 * component-agnostic: it has no knowledge of the registry or any component,
 * and must stay that way (directive nodes carry only a name, attributes,
 * and children; interpreting a name is the renderer's job).
 */
export function parse(text: string): Root {
  const processor = unified().use(remarkParse).use(remarkDirective);
  return processor.parse(text);
}
