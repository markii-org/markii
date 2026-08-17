import { visit } from 'unist-util-visit';
import type { Code, Root } from 'mdast';

/**
 * Slice 1 of the scripting-usability layer (DESIGN.md §8): this module only
 * *reads* script blocks out of an already-parsed AST — it never executes
 * anything, imports no Lua/wasmoon, and knows nothing about a value store.
 * A script block is, at the parse layer, an ordinary fenced code block (see
 * `to-hast.ts`/§8: "plain markdown viewers just show the code") — the only
 * thing that distinguishes it from any other code fence is a `{...}`
 * attribute group in its `meta` string carrying a `name`.
 */

/**
 * One script block found in a document, in document order. `lang` is the
 * fence's language tag (`"lua"` for ` ```lua {name=...}` `, `""` if the
 * fence had no language). `src`, when present, points at a bundle-relative
 * long-script file (§8: "the block becomes a one-line reference,
 * ` ```lua {src=scripts/etl.lua name=stars}` ` with an empty body"); `code`
 * is still the fence's own body (empty for a `src=` reference).
 */
export interface ScriptBlock {
  name: string;
  lang: string;
  src?: string;
  code: string;
  position?: Code['position'];
}

/**
 * Finds the first brace-delimited attribute group (`{...}`) in `source`,
 * returning its inner text (without the braces), or `undefined` if none is
 * present. Braces inside a quoted attribute value are ignored while
 * scanning for the closing `}`, so `{title="a }b" name=x}` still finds the
 * real close brace rather than the one inside the quotes.
 */
function findAttributeGroup(source: string): string | undefined {
  const start = source.indexOf('{');
  if (start === -1) return undefined;

  let quote: '"' | "'" | undefined;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '}') return source.slice(start + 1, i);
  }
  return undefined;
}

/**
 * Token grammar inside a `{...}` attribute group: `key`, `key=bareValue`,
 * `key="quoted value"`, or `key='quoted value'`. Whitespace-separated.
 */
const ATTRIBUTE_TOKEN = /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

/**
 * The full charset a script `name` may use (DESIGN.md §8). Deliberately NOT
 * `g`-flagged: a `g`-flagged `RegExp` carries `lastIndex` state across
 * `.test()` calls (the exec-loop cursor from a previous match survives to
 * the next call on the same instance), which silently makes alternating
 * calls report wrong results — a real bug class. `ATTRIBUTE_TOKEN` above
 * needs `g` because it's driven with `.exec()` in a loop and resets
 * `lastIndex` itself each time; `isValidScriptName` has no such loop, so it
 * gets a plain, stateless pattern instead.
 */
const SCRIPT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Whether `name` is a legal script `name` (DESIGN.md §8). Dots are
 * deliberately excluded from the charset — `data=`/`:value[]` read a dot in
 * a name as path traversal (`repo.stars` means "field `stars` of value
 * `repo`"), which would make a dotted *script* name unreachable from either
 * attribute. Fully anchored (`^`…`$`), so a trailing newline or any other
 * stray character fails the match rather than being silently tolerated.
 */
export function isValidScriptName(name: string): boolean {
  return SCRIPT_NAME_PATTERN.test(name);
}

/**
 * Parses a fence `meta` string's `{...}` attribute group into a flat
 * key/value map (bare `key` with no `=value` yields `''`). Returns an empty,
 * null-prototype object when `meta` has no attribute group at all — the
 * caller treats a missing `name` key the same way either way (not a
 * script), but the null prototype keeps a lookup like `attrs.constructor`
 * from ever resolving to an inherited `Object.prototype` member, matching
 * the defensive pattern already used for the registry (`registry.ts`) and
 * the URL-attribute lookup (`to-hast.ts`).
 *
 * Exported so a renderer (e.g. `@markii/react`) that wants to tell a script
 * block from ordinary code can reuse this exact grammar instead of
 * duplicating the brace/quote/token-scanning logic — `to-hast.ts` preserves
 * the raw fence `meta` string onto the hast `<code>` element for exactly
 * this purpose (see its `preserveCodeMeta` plugin).
 */
export function parseMetaAttributes(
  meta: string | null | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  if (!meta) return attrs;

  const group = findAttributeGroup(meta);
  if (group === undefined) return attrs;

  ATTRIBUTE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_TOKEN.exec(group)) !== null) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

/**
 * Walks a parsed mdast `Root` and returns every script block, in document
 * order. A `code` node is a script iff its `meta` carries a `{...}`
 * attribute group with a non-empty `name` that also matches the script-name
 * charset (DESIGN.md §8, `isValidScriptName`); a code block with no meta,
 * meta with no `name`, or a `name` outside the charset (e.g. a dotted
 * `repo.stars`) is ordinary code and is skipped — same display-only
 * degradation either way, never an error and never a console message. Pure
 * AST inspection — no execution, no I/O, no knowledge of any value store.
 */
export function extractScripts(tree: Root): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];

  visit(tree, 'code', (node: Code) => {
    const attrs = parseMetaAttributes(node.meta);
    const name = attrs.name;
    if (!name || !isValidScriptName(name)) return;

    const block: ScriptBlock = {
      name,
      lang: node.lang ?? '',
      code: node.value,
    };
    if (attrs.src) block.src = attrs.src;
    if (node.position) block.position = node.position;
    blocks.push(block);
  });

  return blocks;
}
