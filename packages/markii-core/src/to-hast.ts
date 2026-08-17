import { unified } from 'unified';
import type { Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import type { Code, Root as MdastRoot, RootContent } from 'mdast';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from 'mdast-util-directive';

/** The hast tag name our directive-tagging plugin marks directive nodes with. */
const DIRECTIVE_TAG = 'mk-directive';

type DirectiveNode = ContainerDirective | LeafDirective | TextDirective;

function isDirectiveNode(node: { type: string }): node is DirectiveNode {
  return (
    node.type === 'containerDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'textDirective'
  );
}

/**
 * Raw attributes as `mdast-util-directive` represents them: a bare
 * (valueless) attribute, e.g. `{collapsed}`, arrives as an empty string.
 * This is a module-local shape, not the registry-facing contract (that
 * lives in `@markii/react`'s `registry.ts`, which normalizes `''` to `null` on
 * the far side of the JSON round-trip below).
 */
type RawDirectiveAttributes = Record<string, string | null | undefined>;

/**
 * Small remark plugin: tags every directive node with `data.hName` /
 * `data.hProperties` so that `remark-rehype`'s default mdast->hast
 * conversion turns it into a `<mk-directive>` hast element carrying the
 * directive's name, raw attributes, and shape (inline vs block) as data-*
 * properties. Inner markdown is left untouched, so it converts to hast
 * exactly like any other node — this is what makes it become
 * already-rendered `children` on the renderer side.
 */
const tagDirectiveNodes: Plugin<[], MdastRoot> = () => (tree) => {
  visit(tree, (node) => {
    if (!isDirectiveNode(node)) return;
    node.data = {
      ...node.data,
      hName: DIRECTIVE_TAG,
      hProperties: {
        'data-mk-name': node.name,
        'data-mk-attrs': JSON.stringify(normalizeAttributes(node.attributes)),
        'data-mk-kind': node.type,
      },
    };
  });
};

/**
 * mdast-util-directive represents a bare (valueless) attribute, e.g.
 * `{collapsed}`, as an empty string. The registry-facing contract instead
 * uses `null` for "present but valueless" — this normalization is what
 * lands in the serialized `data-mk-attrs` JSON that the renderer parses
 * back out.
 */
function normalizeAttributes(
  attributes: RawDirectiveAttributes | null | undefined,
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    result[key] = value === '' || value == null ? null : value;
  }
  return result;
}

/**
 * The hast/DOM attribute a fenced code block's raw `meta` string (e.g.
 * `"{name=stars}"`) is preserved onto, since `mdast-util-to-hast`'s default
 * `code` handler drops mdast `meta` entirely when building the hast
 * `<code>` element.
 */
const CODE_META_ATTR = 'data-mk-meta';

/**
 * Small remark plugin: copies a code fence's raw `meta` string onto the
 * mdast `code` node's `data.hProperties`, so it survives the mdast->hast
 * conversion as a `data-mk-meta` attribute on the resulting `<code>`
 * element (`mdast-util-to-hast`'s `code` handler applies `hProperties` to
 * the `<code>` it builds, not the wrapping `<pre>` — see its
 * `handlers/code.js`). This is deliberately generic meta *preservation*,
 * not script detection: `@markii/core` stays framework-agnostic and knows
 * nothing about "script blocks" here. A renderer that cares (e.g.
 * `@markii/react`) reads this attribute and parses it with this package's
 * `parseMetaAttributes` (`scripts.ts`) to decide whether a code block is a
 * script; a renderer that doesn't care ignores the attribute and the block
 * still renders as plain `<pre><code>` either way.
 */
const preserveCodeMeta: Plugin<[], MdastRoot> = () => (tree) => {
  visit(tree, 'code', (node: Code) => {
    if (!node.meta) return;
    node.data = {
      ...node.data,
      hProperties: { [CODE_META_ATTR]: node.meta },
    };
  });
};

/** URL schemes allowed in `href`/`src`, matched case-insensitively. */
const SAFE_URL_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Modelled on react-markdown's `defaultUrlTransform`, though our allowlist
 * differs from theirs (we add `tel`; we drop `ircs` and `xmpp`) — see
 * `SAFE_URL_PROTOCOLS` above for the actual list. A URL with no scheme
 * (relative, fragment-only `#...`, or query-only `?...`) is always allowed;
 * a URL with a scheme is allowed only if that scheme is in
 * `SAFE_URL_PROTOCOLS`. Finding the "scheme" the same way a browser does —
 * text before the first `:`, but only when that `:` comes before any `/`,
 * `?`, or `#` — is what correctly rejects tricks like a leading space
 * (`" javascript:..."`, whose slice-before-colon is `" javascript"`, which
 * never matches a bare protocol name) while still allowing a same-origin
 * path that happens to contain a colon later on.
 *
 * Exported (not just used by `sanitizeUrls` below) because a directive
 * *attribute* that a renderer maps straight to a DOM URL prop — e.g.
 * `@markii/react`'s `figure` component putting a `src` attribute into
 * `<img src>` — never passes through `sanitizeUrls`, which only walks the
 * hast tree `remark-rehype` itself produces from markdown links/images.
 * Such a renderer must run the attribute value through this same check
 * itself, rather than re-implementing URL-scheme parsing, to get the exact
 * same guarantee.
 */
export function isSafeUrl(url: string): boolean {
  const colon = url.indexOf(':');
  if (colon === -1) return true;

  const slash = url.indexOf('/');
  const questionMark = url.indexOf('?');
  const numberSign = url.indexOf('#');
  const hasSchemeBeforeDelimiter =
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign);

  if (!hasSchemeBeforeDelimiter) return true;

  return SAFE_URL_PROTOCOLS.has(url.slice(0, colon).toLowerCase());
}

/**
 * hast tag name -> the one attribute on it that carries a URL. Null-prototype
 * (rather than a plain object literal) so a hast tag named `constructor`,
 * `toString`, etc. must miss this lookup rather than resolve to an
 * inherited `Object.prototype` member.
 */
const URL_ATTRIBUTE_BY_TAG: Record<string, 'href' | 'src'> = Object.assign(
  Object.create(null) as Record<string, 'href' | 'src'>,
  { a: 'href', img: 'src' },
);

/**
 * Strips `href` on `<a>` and `src` on `<img>` when they hold an unsafe URL
 * (e.g. `javascript:`, `data:text/html`), mutating the hast tree in place.
 * Runs after `remark-rehype`, so it covers every link/image the document
 * produces regardless of source (CommonMark autolinks, `[text](url)`, raw
 * `<a href>` — remark-rehype normalizes all of them to hast `element` nodes
 * by this point). The element and its children are kept — only the
 * dangerous attribute is dropped — so link text still renders, per the
 * fallback-not-failure spirit of Architecture rule 3.
 */
function sanitizeUrls(tree: HastRoot): void {
  visit(tree, 'element', (node: HastElement) => {
    const attr = URL_ATTRIBUTE_BY_TAG[node.tagName];
    if (!attr) return;
    const value = node.properties[attr];
    if (typeof value === 'string' && !isSafeUrl(value)) {
      delete node.properties[attr];
    }
  });
}

/**
 * The ONE source of truth for the mdast->hast pipeline's plugin list, shared
 * by `toHast` (whole-document) and `nodeToHast` (single-node) below —
 * exactly one `.use()` chain exists in this module so the two entry points
 * cannot drift apart on directive tagging, code-meta preservation, or the
 * remark-rehype conversion itself. Building a fresh processor per call
 * (rather than a shared module-level instance) matches `unified`'s own
 * immutable-processor model (`.use()` returns a new processor) and keeps
 * each call's `.parse`/`.runSync` free of any state left over from a
 * previous call.
 */
function createProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkGfm)
    .use(tagDirectiveNodes)
    .use(preserveCodeMeta)
    .use(remarkRehype);
}

/**
 * Converts Mark text straight to a sanitized hast tree: parse (mdast, with
 * directive + GFM syntax extensions) -> tag directive nodes + preserve
 * code-fence meta for hast conversion -> remark-rehype (hast) -> strip
 * unsafe URLs. GFM constructs (tables, task lists, strikethrough, autolinks)
 * need no tagging step of their own — `remark-rehype`'s default handlers
 * already turn them into standard `<table>`/`<input type=checkbox>`/`<del>`/
 * `<a>` hast elements, and `sanitizeUrls` below covers every `<a href>`/
 * `<img src>` regardless of whether it came from a GFM autolink or an
 * ordinary link. This is the framework-agnostic half of rendering —
 * `@markii/react` (or any other renderer) turns this hast tree into its own
 * component tree, resolving `<mk-directive>` elements through a registry and
 * `data-mk-meta` on `<code>` elements however it likes (e.g. a collapsed
 * script marker).
 */
export function toHast(text: string): HastRoot {
  const processor = createProcessor();
  const mdastTree = processor.parse(text);
  const hastTree = processor.runSync(mdastTree) as HastRoot;
  sanitizeUrls(hastTree);
  return hastTree;
}

/**
 * One mdast node as this package's `parse` produces it (a member of a
 * `Root`'s `children` array — `mdast`'s own `RootContent` union). Re-exported
 * under this package's naming so a consumer (e.g. `@markii/react`'s
 * `renderMarkNode`) can type a "single already-parsed node" parameter without
 * adding its own `@types/mdast` dependency — `@markii/core` already depends
 * on it.
 */
export type MarkNode = RootContent;

/**
 * Deletes `data` from every node in `tree`, in place.
 *
 * Security-relevant, and specific to the single-node path. mdast `data` is
 * the documented channel for overriding hast output — `mdast-util-to-hast`
 * reads `data.hName`, `data.hProperties`, and `data.hChildren` and will emit
 * *any* tag with *any* attributes a node asks for. `toHast` can never be
 * handed such a node: it takes TEXT and parses it itself, and
 * `remark-parse`/`remark-directive`/`remark-gfm` never populate `data` on the
 * nodes they produce. `nodeToHast` instead accepts an already-built AST from
 * the caller, so without this step a node carrying
 * `data.hName = 'script'` + `data.hProperties = { src: 'javascript:...' }`
 * would convert to a real `<script src="javascript:...">` hast element —
 * bypassing `sanitizeUrls` entirely, since that only guards `a[href]` and
 * `img[src]`. Any host that transforms the AST between `parse` and rendering
 * (or renders a node built from untrusted input) would inherit an injection
 * path that the document path simply does not have.
 *
 * Deleting `data` WHOLESALE, rather than allowlisting away the three known
 * `h*` keys, is the deliberate choice: it is fail-closed by construction (a
 * future `mdast-util-to-hast` release that honors a fourth `data.h*` key
 * cannot silently reopen this hole, whereas a hardcoded three-name denylist
 * would), and it costs nothing in fidelity — since parser-produced nodes
 * carry no `data` at all, stripping it reproduces exactly the shape the
 * document path feeds the pipeline. The pipeline's own tagging
 * (`tagDirectiveNodes`, `preserveCodeMeta`) runs AFTER this and repopulates
 * `data` itself, so directives and code fences are unaffected.
 */
function stripHastOverrides(tree: MdastRoot): void {
  visit(tree, (node: { data?: unknown }) => {
    if (node.data !== undefined) delete node.data;
  });
}

/**
 * An empty hast root, returned by `nodeToHast` when the pipeline itself
 * throws on odd input (Architecture rule 3's never-throw guarantee, extended
 * to the single-node path) — degraded output, never an exception.
 */
function emptyHastRoot(): HastRoot {
  return { type: 'root', children: [] };
}

/**
 * Converts a single already-parsed mdast node (as produced by this package's
 * `parse`, e.g. one top-level child of its `Root`) to a sanitized hast tree,
 * running the exact SAME pipeline as `toHast` — see `createProcessor` above,
 * the one shared plugin-list source of truth — over a synthetic mdast `root`
 * wrapping just this node. Directive tagging, code-meta preservation, and URL
 * sanitizing (`sanitizeUrls`) all run identically to the whole-document path;
 * the only difference is skipping `processor.parse` (there is no text to
 * parse — `node` is already an AST) and wrapping in a throwaway root instead
 * of using the document's own.
 *
 * Pure: `node` is deep-cloned (`structuredClone` — mdast nodes are plain
 * JSON-safe data) before the pipeline runs, so the plugins' in-place
 * `data.hName`/`data.hProperties` mutations never touch the caller's node.
 *
 * Hardened: because this entry point takes an AST rather than text, the
 * clone is also stripped of every node's `data` — the caller-controllable
 * hast-override channel — before the pipeline runs, so a hand-built or
 * transformed node cannot dictate the emitted tag/attributes (e.g. a
 * `data.hName: 'script'` injection). See `stripHastOverrides`.
 *
 * Never throws, matching `toHast`'s and Architecture rule 3's
 * never-throw-on-odd-input guarantee: an inline/text-level node at the root
 * of the synthetic tree, a `code` node with malformed `meta`, or a
 * container-directive subtree left over from an unclosed fence may all
 * produce degraded hast (in the worst case, an empty root — `emptyHastRoot`),
 * but the call itself cannot fail.
 */
export function nodeToHast(node: MarkNode): HastRoot {
  try {
    const cloned = structuredClone(node);
    const root: MdastRoot = { type: 'root', children: [cloned] };
    // Before the pipeline runs: drop any caller-supplied hast overrides
    // (`data.hName`/`hProperties`/`hChildren`) so only this pipeline's own
    // tagging can influence the hast output. See `stripHastOverrides`.
    stripHastOverrides(root);
    const processor = createProcessor();
    const hastTree = processor.runSync(root) as HastRoot;
    sanitizeUrls(hastTree);
    return hastTree;
  } catch {
    return emptyHastRoot();
  }
}
