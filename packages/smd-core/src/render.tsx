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
import type { Root as HastRoot } from 'hast';
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
    const entry = registry[name];

    if (!entry) {
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

function parseToHast(text: string): HastRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(tagDirectiveNodes)
    .use(remarkRehype);
  const mdastTree = processor.parse(text);
  return processor.runSync(mdastTree) as HastRoot;
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
