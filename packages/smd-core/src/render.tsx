import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { unified } from 'unified';
import type { Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Root as MdastRoot } from 'mdast';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from 'mdast-util-directive';
import type { DirectiveAttributes, Registry } from './registry';
import { UnknownDirective } from './components/unknown-directive';

/** The hast tag name our directive-tagging plugin marks directive nodes with. */
const DIRECTIVE_TAG = 'smd-directive';

type DirectiveNode = ContainerDirective | LeafDirective | TextDirective;

function isDirectiveNode(node: { type: string }): node is DirectiveNode {
  return (
    node.type === 'containerDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'textDirective'
  );
}

/**
 * Small remark plugin: tags every directive node with `data.hName` /
 * `data.hProperties` so that `remark-rehype`'s default mdast->hast
 * conversion turns it into a `<smd-directive>` hast element carrying the
 * directive's name, raw attributes, and shape (inline vs block) as data-*
 * properties. Inner markdown is left untouched, so it converts to hast (and
 * later JSX) exactly like any other node — this is what makes it become
 * already-rendered `children` on the other side.
 */
const tagDirectiveNodes: Plugin<[], MdastRoot> = () => (tree) => {
  visit(tree, (node) => {
    if (!isDirectiveNode(node)) return;
    node.data = {
      ...node.data,
      hName: DIRECTIVE_TAG,
      hProperties: {
        'data-smd-name': node.name,
        'data-smd-attrs': JSON.stringify(normalizeAttributes(node.attributes)),
        'data-smd-kind': node.type,
      },
    };
  });
};

/**
 * mdast-util-directive represents a bare (valueless) attribute, e.g.
 * `{collapsed}`, as an empty string. The registry-facing contract instead
 * uses `null` for "present but valueless", matching `DirectiveAttributes`.
 */
function normalizeAttributes(
  attributes: DirectiveAttributes | null | undefined,
): DirectiveAttributes {
  const result: DirectiveAttributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    result[key] = value === '' ? null : value;
  }
  return result;
}

function parseAttributes(json: string | undefined): DirectiveAttributes {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const result: DirectiveAttributes = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === 'string' || value === null || value === undefined) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

interface DirectiveElementProps {
  'data-smd-name'?: string;
  'data-smd-attrs'?: string;
  'data-smd-kind'?: string;
  children?: ReactNode;
}

// hast-util-to-jsx-runtime's `Components` map is keyed by `JSX.IntrinsicElements`
// (see its readme: "Each key is a tag name typed in JSX.IntrinsicElements").
// Registering our marker tag there is the supported way to give it a typed
// `components` entry below, without a cast or `any`.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'smd-directive': DirectiveElementProps;
    }
  }
}

/**
 * Builds the React component used to replace every `<smd-directive>` hast
 * element: looks the directive name up in `registry`, and renders the
 * matching component with parsed attributes and pre-rendered children — or
 * the neutral fallback box if the name isn't registered. This is the only
 * place a directive name is resolved; it never throws.
 *
 * Typed as a plain function (not React's `ComponentType`, whose declared
 * return type is the broader `ReactNode`) because hast-util-to-jsx-runtime's
 * `Components` map expects a component returning `JSX.Element | string |
 * null | undefined` — narrower than `ReactNode`. This component always
 * returns a `ReactElement`, so the narrower signature is also the honest one.
 */
function createDirectiveElement(
  registry: Registry,
): (props: DirectiveElementProps) => ReactElement {
  return function DirectiveElement(props: DirectiveElementProps): ReactElement {
    const name = props['data-smd-name'] ?? '';
    const kind = props['data-smd-kind'];
    const attributes = parseAttributes(props['data-smd-attrs']);
    // `Object.hasOwn` (rather than `registry[name]` / `name in registry`)
    // guards against a directive named `constructor`, `toString`,
    // `valueOf`, `hasOwnProperty`, etc. resolving through the prototype
    // chain to an inherited `Object.prototype` member instead of falling
    // through to the unknown-directive fallback (Architecture rule 3: unknown
    // directives never throw). The `entry?.component == null` check is a
    // second belt-and-suspenders guard for the same class of bug — it must
    // be a nullish check rather than `typeof ... !== 'function'`, since
    // `React.memo`/`forwardRef`/`lazy` all produce a component whose
    // `typeof` is `'object'`, not `'function'`, and TypeScript's
    // `ComponentType` accepts all of them.
    const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;

    if (entry?.component == null) {
      return (
        <UnknownDirective
          name={name || '(unnamed)'}
          inline={kind === 'textDirective'}
        >
          {props.children}
        </UnknownDirective>
      );
    }

    const Component = entry.component;
    return <Component attributes={attributes}>{props.children}</Component>;
  };
}

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
 * (rather than a plain object literal) for the same reason `createRegistry`
 * is: a hast tag named `constructor`, `toString`, etc. must miss this lookup
 * rather than resolve to an inherited `Object.prototype` member.
 */
const URL_ATTRIBUTE_BY_TAG: Record<string, 'href' | 'src'> = Object.assign(
  Object.create(null) as Record<string, 'href' | 'src'>,
  { a: 'href', img: 'src' },
);

/**
 * Strips `href` on `<a>` and `src` on `<img>` when they hold an unsafe URL
 * (e.g. `javascript:`, `data:text/html`), mutating the hast tree in place.
 * Runs after `remark-rehype` and before `hast-util-to-jsx-runtime`, so it
 * covers every link/image the document produces regardless of source
 * (CommonMark autolinks, `[text](url)`, raw `<a href>` — remark-rehype
 * normalizes all of them to hast `element` nodes by this point). The
 * element and its children are kept — only the dangerous attribute is
 * dropped — so link text still renders, per the fallback-not-failure spirit
 * of Architecture rule 3.
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

function parseToHast(text: string): HastRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(tagDirectiveNodes)
    .use(remarkRehype);
  const mdastTree = processor.parse(text);
  const hastTree = processor.runSync(mdastTree) as HastRoot;
  sanitizeUrls(hastTree);
  return hastTree;
}

/**
 * Renders Super Markdown text to a React element tree using `registry` to
 * resolve directive names. Pipeline: parse (mdast) -> tag directive nodes
 * for hast conversion -> remark-rehype (hast) -> hast-util-to-jsx-runtime
 * (React elements), with directive elements swapped for registry
 * components (or the unknown-directive fallback) along the way. Never
 * throws: parsing is tolerant by construction, and unresolved directive
 * names always render a fallback rather than fail.
 */
export function renderSmd(text: string, registry: Registry): ReactElement {
  try {
    const hastTree = parseToHast(text);
    const DirectiveElement = createDirectiveElement(registry);
    return toJsxRuntime(hastTree, {
      Fragment,
      jsx,
      jsxs,
      components: { 'smd-directive': DirectiveElement },
    }) as ReactElement;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="smd-unknown smd-unknown--block" role="alert">
        <p className="smd-unknown__label">failed to render document</p>
        <pre className="smd-unknown__content">{message}</pre>
      </div>
    );
  }
}
