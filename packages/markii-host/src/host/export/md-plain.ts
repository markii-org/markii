/**
 * The `md-plain` export format: a SOURCE-LEVEL rewrite of a note down to
 * plain CommonMark. Moved out of `apps/cli/src/export-note.ts` (the only
 * host that ever offered this format): pure logic over `@markii/core`'s
 * parse tree that never imports `node:*`, so it never belonged behind an
 * app's main entry in the first place.
 *
 * No markdown serializer, no new dependency: every directive's own
 * fence/bracket syntax is deleted from the original text using the
 * offsets `@markii/core`'s `parse` already puts on every node, leaving the
 * author's own inner markdown untouched.
 */
import { parse, extractScripts, type ScriptBlock } from '@markii/core';
import { visit, SKIP } from 'unist-util-visit';
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from 'mdast-util-directive';
import type { Position } from 'unist';

interface SourceEdit {
  readonly start: number;
  readonly end: number;
}

type MarkTree = ReturnType<typeof parse>;

function offsetsOf(position: Position | undefined): SourceEdit | undefined {
  if (
    position === undefined ||
    position.start.offset === undefined ||
    position.end.offset === undefined
  ) {
    return undefined;
  }
  return { start: position.start.offset, end: position.end.offset };
}

/**
 * The shared logic for a container directive or a text directive: keep
 * exactly the children's own source range, trimming the fence lines
 * (container) or `:name[`/`]{...}` (text) away on either side. An empty
 * directive (no children — attributes only, or no label) has nothing to
 * preserve, so its whole range is removed instead, and visiting does not
 * need to descend into it.
 */
function wrapperEdits(
  node: ContainerDirective | TextDirective,
  edits: SourceEdit[],
): typeof SKIP | undefined {
  const outer = offsetsOf(node.position);
  if (outer === undefined) return undefined;

  const { children } = node;
  if (children.length === 0) {
    edits.push(outer);
    return SKIP;
  }

  const first = children[0];
  const last = children[children.length - 1];
  const firstOffsets = offsetsOf(first?.position);
  const lastOffsets = offsetsOf(last?.position);

  if (firstOffsets !== undefined && firstOffsets.start > outer.start) {
    edits.push({ start: outer.start, end: firstOffsets.start });
  }
  if (lastOffsets !== undefined && lastOffsets.end < outer.end) {
    edits.push({ start: lastOffsets.end, end: outer.end });
  }
  // No SKIP: keep visiting into `children` so a nested directive inside
  // this one's content still gets its own wrapper stripped.
  return undefined;
}

/**
 * Every directive's wrapper-syntax edit: a leaf directive (`::name[...]`)
 * is removed in full (there is no "inner markdown" to keep — a leaf
 * directive's label is inline attributes-shaped content, not a nested
 * document); a container or text directive keeps its inner markdown and
 * loses only its own fence/bracket syntax (`wrapperEdits`, above).
 */
function collectDirectiveEdits(tree: MarkTree): SourceEdit[] {
  const edits: SourceEdit[] = [];

  visit(tree, 'containerDirective', (node) => wrapperEdits(node, edits));
  visit(tree, 'textDirective', (node) => wrapperEdits(node, edits));
  visit(tree, 'leafDirective', (node: LeafDirective) => {
    const outer = offsetsOf(node.position);
    if (outer !== undefined) edits.push(outer);
    return SKIP;
  });

  return edits;
}

/** Script fences are removed entirely — their own `position` (the whole fence, per `@markii/core`'s `extractScripts`) is the edit. */
function collectScriptEdits(tree: MarkTree): SourceEdit[] {
  const edits: SourceEdit[] = [];
  const blocks: ScriptBlock[] = extractScripts(tree);
  for (const block of blocks) {
    const offsets = offsetsOf(block.position);
    if (offsets !== undefined) edits.push(offsets);
  }
  return edits;
}

/**
 * Downgrades `text` to plain CommonMark: container directives lose their
 * opening/closing fence lines and keep their inner markdown, leaf
 * directives are removed, a text directive is replaced by its own text
 * content, and named script fences are removed entirely. A component
 * becomes its inner content only — this is a readability floor, not a
 * faithful render.
 *
 * Every edit is a pure deletion (the inner text a directive wraps is
 * already the correct, final text — nothing is rewritten, only the
 * surrounding directive syntax is cut away), applied from the END of the
 * source backwards so earlier offsets stay valid as later ones are
 * consumed.
 */
export function mdPlainFromSource(text: string): string {
  const tree = parse(text);
  const edits = [
    ...collectDirectiveEdits(tree),
    ...collectScriptEdits(tree),
  ].sort((a, b) => b.start - a.start);

  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + result.slice(edit.end);
  }
  return collapseBlankRuns(result);
}

/**
 * Collapses a run of three or more consecutive newlines down to two, and
 * trims the leading and trailing blank lines off the whole file.
 *
 * Cutting a directive out of the source leaves the blank lines that stood
 * on either side of it behind, so a note with a few leaf directives comes
 * out pocked with three and four line gaps. CommonMark treats any run of
 * blank lines as one paragraph break, so closing them up changes nothing
 * about how the file parses and a great deal about how it reads.
 */
function collapseBlankRuns(text: string): string {
  return `${text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')}\n`;
}
