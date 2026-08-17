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
 *
 * `publish`, when present, is always `true` — DESIGN.md §8: "**Publishing is
 * declarative**: the bare `publish` attribute on the script fence, no API to
 * call." "Bare" is load-bearing: it is set ONLY when the fence spells the
 * key with no `=value` at all (` ```lua {name=gh publish}` `, per
 * `parseMetaAttributes`'s bare-key convention of yielding `''`). Any valued
 * spelling — `publish=true`, `publish=yes`, `publish=1`, even `publish=false`
 * or `publish=""` — is a DIFFERENT, undefined attribute, not the one the
 * format specifies, and is silently ignored (the block simply does not
 * publish), matching the format's "unrecognized input degrades, never
 * throws" rule. This is deliberately fail-closed rather than lenient:
 * publishing "writes beyond the note" (§8), so guessing at an unrecognized
 * spelling risks writing to the shared vault when the author didn't mean to
 * — silently NOT publishing is always the safe wrong answer, silently
 * publishing never is. In particular `publish=false` must never be treated
 * as an opt-out toggle that flips a default-on behavior; there is no such
 * toggle, only the presence or absence of the one bare form.
 *
 * The field is only ever set when true, so a non-publishing block's shape is
 * byte-identical to a `ScriptBlock` from before this field existed (no
 * `publish: false` litter). Use `Object.hasOwn`/`'publish' in block` to test
 * for absence, not falsiness.
 */
export interface ScriptBlock {
  name: string;
  lang: string;
  src?: string;
  code: string;
  publish?: true;
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
 * Whether `key` appears in `meta`'s `{...}` attribute group written
 * genuinely bare (`key` with no `=value` at all — none of the three value
 * alternatives in `ATTRIBUTE_TOKEN` matched). This is the ONE shared
 * mechanism for a bare-only boolean fence-meta attribute (DESIGN.md §8:
 * "Boolean fence-meta attributes (`publish`, the reference renderer's
 * `open`) are bare-only: writing any value — `publish=true` no less than
 * `publish=false` — is not the boolean form and counts as absent. Fail
 * closed: an unrecognized spelling must never enable behavior."). Used by
 * `extractScripts` below for `publish`, and by `@markii/react`'s `PreElement`
 * for `open` (see `ScriptBlock.publish`'s doc comment for why the
 * bare/valued distinction matters).
 *
 * `parseMetaAttributes` collapses a bare key and an explicitly-empty quoted
 * value (`key=""`) to the same `''` result in its flat map — the right
 * choice for its general-purpose contract, but it erases exactly the
 * distinction a bare-only attribute needs (`{publish}` must enable
 * publishing; `{publish=""}` must not — and likewise `{open}` vs.
 * `{open=""}`/`{open=true}`/`{open=false}`). So this walks the same token
 * grammar directly instead of going through that already-flattened map.
 * Like `parseMetaAttributes`, a key repeated in the group is "last
 * occurrence wins" (the loop keeps overwriting `bare` for each match of
 * `key`).
 *
 * Exported so a renderer (e.g. `@markii/react`) that defines its own
 * bare-only boolean fence-meta attribute reuses this exact grammar instead
 * of duplicating (and risking drift from) the bare/valued distinction here.
 */
export function isBareAttribute(
  meta: string | null | undefined,
  key: string,
): boolean {
  if (!meta) return false;
  const group = findAttributeGroup(meta);
  if (group === undefined) return false;

  ATTRIBUTE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let bare = false;
  while ((match = ATTRIBUTE_TOKEN.exec(group)) !== null) {
    if (match[1] !== key) continue;
    bare =
      match[2] === undefined &&
      match[3] === undefined &&
      match[4] === undefined;
  }
  return bare;
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
    // Bare-only, per `ScriptBlock.publish`'s doc comment and
    // `isBareAttribute`'s: a plain `attrs.publish === ''` check can't tell
    // `{publish}` from `{publish=""}` (both flatten to `''`), so this asks
    // the token grammar directly instead of trusting the flattened map.
    if (isBareAttribute(node.meta, 'publish')) {
      block.publish = true;
    }
    if (node.position) block.position = node.position;
    blocks.push(block);
  });

  return blocks;
}
