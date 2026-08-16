import { unified } from 'unified';
import type { Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import type { Code, Root as MdastRoot } from 'mdast';
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
 */
function isSafeUrl(url: string): boolean {
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
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkGfm)
    .use(tagDirectiveNodes)
    .use(preserveCodeMeta)
    .use(remarkRehype);
  const mdastTree = processor.parse(text);
  const hastTree = processor.runSync(mdastTree) as HastRoot;
  sanitizeUrls(hastTree);
  return hastTree;
}
