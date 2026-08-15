import { parse } from 'smd-core';

export type ParseStatus =
  { ok: true; directiveCount: number } | { ok: false; error: string };

const DIRECTIVE_TYPES = new Set([
  'textDirective',
  'leafDirective',
  'containerDirective',
]);

/**
 * Counts directive nodes (inline, leaf, and container) in a parsed mdast
 * tree. Walks with `unknown` + runtime narrowing rather than importing
 * `mdast`'s types (or `unist-util-visit`) — the playground has no direct
 * dependency on either, and `smd-core`'s exported `parse()` return type is
 * enough on its own without adding one just for this status line.
 */
function countDirectives(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  const record = node as { type?: unknown; children?: unknown };
  const own =
    typeof record.type === 'string' && DIRECTIVE_TYPES.has(record.type) ? 1 : 0;
  const children = Array.isArray(record.children) ? record.children : [];
  return children.reduce<number>(
    (sum, child) => sum + countDirectives(child),
    own,
  );
}

/**
 * The playground status bar's data source: parses `text` with `smd-core`'s
 * `parse()` and reports either a directive count or the error message.
 * `smd-core`'s parser is tolerant by construction and shouldn't throw on any
 * input, but this stays defensive (matching `renderSmd`'s own try/catch)
 * rather than assuming that invariant holds forever.
 */
export function getParseStatus(text: string): ParseStatus {
  try {
    const tree = parse(text);
    return { ok: true, directiveCount: countDirectives(tree) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
