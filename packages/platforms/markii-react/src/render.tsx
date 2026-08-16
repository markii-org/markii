import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { toHast, parseMetaAttributes } from '@markii/core';
import type { ValueStatus, ValueStore } from '@markii/runtime';
import type { Element as HastElement } from 'hast';
import type { DirectiveAttributes, Registry } from './registry';
import { ScriptMarker } from './components/script-marker';
import { UnknownDirective } from './components/unknown-directive';
import { ValueDirective } from './components/value-directive';

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
  'data-mk-name'?: string;
  'data-mk-attrs'?: string;
  'data-mk-kind'?: string;
  children?: ReactNode;
}

/** The reserved directive name for render-time value interpolation (§8: `:value[name]`). */
const VALUE_DIRECTIVE_NAME = 'value';

/** The one attribute key that binds a directive to the value store instead of passing through as a raw string (§8: `data=name`). */
const DATA_ATTRIBUTE_KEY = 'data';

interface ResolvedDataBinding {
  attributes: DirectiveAttributes;
  data?: unknown;
  dataStatus?: ValueStatus;
}

/**
 * Splits a `data=<name>` attribute (if present) off `attributes`, resolves
 * `<name>` against `store`, and returns the resolved binding plus the
 * remaining attributes (every other attribute is untouched — this only
 * ever special-cases the `data` key). Never throws: no store, an empty/bare
 * `data` attribute, and an unknown name all degrade to `dataStatus:
 * 'missing'` with `data: undefined`, the same graceful-degradation spirit
 * as the unknown-directive fallback.
 */
function resolveDataAttribute(
  attributes: DirectiveAttributes,
  store: ValueStore | undefined,
): ResolvedDataBinding {
  if (!Object.hasOwn(attributes, DATA_ATTRIBUTE_KEY)) {
    return { attributes };
  }

  const { [DATA_ATTRIBUTE_KEY]: rawName, ...rest } = attributes;
  if (!rawName) {
    return { attributes: rest, data: undefined, dataStatus: 'missing' };
  }

  const entry = store?.get(rawName);
  if (!entry) {
    return { attributes: rest, data: undefined, dataStatus: 'missing' };
  }

  return { attributes: rest, data: entry.value, dataStatus: entry.status };
}

// hast-util-to-jsx-runtime's `Components` map is keyed by `JSX.IntrinsicElements`
// (see its readme: "Each key is a tag name typed in JSX.IntrinsicElements").
// Registering our marker tag there is the supported way to give it a typed
// `components` entry below, without a cast or `any`.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'mk-directive': DirectiveElementProps;
    }
  }
}

/**
 * Builds the React component used to replace every `<mk-directive>` hast
 * element (tagged by `@markii/core`'s `toHast`): looks the directive name up in
 * `registry`, and renders the matching component with parsed attributes and
 * pre-rendered children — or the neutral fallback box if the name isn't
 * registered. This is the only place a directive name is resolved; it
 * never throws.
 *
 * Typed as a plain function (not React's `ComponentType`, whose declared
 * return type is the broader `ReactNode`) because hast-util-to-jsx-runtime's
 * `Components` map expects a component returning `JSX.Element | string |
 * null | undefined` — narrower than `ReactNode`. This component always
 * returns a `ReactElement`, so the narrower signature is also the honest one.
 */
function createDirectiveElement(
  registry: Registry,
  store: ValueStore | undefined,
): (props: DirectiveElementProps) => ReactElement {
  return function DirectiveElement(props: DirectiveElementProps): ReactElement {
    const name = props['data-mk-name'] ?? '';
    const kind = props['data-mk-kind'];
    const attributes = parseAttributes(props['data-mk-attrs']);

    // `:value[name]` (§8) is a renderer built-in, resolved before any
    // registry lookup — like the unknown-directive fallback, it is not
    // something a pack can register over; it is part of the render-time
    // interpolation contract itself.
    if (name === VALUE_DIRECTIVE_NAME) {
      return <ValueDirective store={store}>{props.children}</ValueDirective>;
    }

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
    const binding = resolveDataAttribute(attributes, store);
    // `data`/`dataStatus` are only spread in when the directive actually had
    // a `data=` attribute (`'data' in binding`) — NOT whenever
    // `binding.data` happens to be defined. Without this check, JSX would
    // always pass `data`/`dataStatus` as explicit (if `undefined`) props,
    // so `'data' in props` inside a component would be `true` even for a
    // directive with no `data=` attribute at all, defeating the very
    // distinction `registry.ts`'s `SmdComponentProps` doc comment promises
    // ("absent — not merely falsy — when the directive had no `data=`
    // attribute").
    const dataProps =
      'data' in binding
        ? { data: binding.data, dataStatus: binding.dataStatus }
        : {};
    return (
      <Component attributes={binding.attributes} {...dataProps}>
        {props.children}
      </Component>
    );
  };
}

/** The hast/DOM attribute `@markii/core`'s `toHast` preserves a code fence's raw `meta` string onto (see `to-hast.ts`'s `preserveCodeMeta`). */
const CODE_META_ATTR = 'data-mk-meta';

/** The bare (valueless) meta attribute that opts a script marker into rendering already-expanded. */
const OPEN_ATTRIBUTE_KEY = 'open';

/** The first element child of `node` named `tagName`, or `undefined` if there is none (or `node` itself is absent). */
function findChildElement(
  node: HastElement | undefined,
  tagName: string,
): HastElement | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName === tagName) return child;
  }
  return undefined;
}

/** Reads the fence's language tag off the `language-<lang>` class mdast-util-to-hast's default `code` handler adds, or `''` if there is none. */
function getLanguage(codeNode: HastElement | undefined): string {
  const classNames = codeNode?.properties.className ?? [];
  for (const name of classNames) {
    if (typeof name === 'string' && name.startsWith('language-')) {
      return name.slice('language-'.length);
    }
  }
  return '';
}

/**
 * Reads a code element's exact fence body text back out of its hast text
 * children. `mdast-util-to-hast`'s `code` handler appends exactly one
 * trailing `"\n"` to a non-empty value when building the hast text node
 * (`handlers/code.js`: `node.value ? node.value + '\n' : ''`) — stripping
 * that single trailing newline back off recovers the original fenced-code
 * source exactly, byte-for-byte, rather than re-deriving it from anywhere
 * else.
 */
function getCodeText(codeNode: HastElement | undefined): string {
  if (!codeNode) return '';
  let text = '';
  for (const child of codeNode.children) {
    if (child.type === 'text') text += child.value;
  }
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

interface PreElementProps {
  node?: HastElement;
  children?: ReactNode;
}

/**
 * Overrides hast-util-to-jsx-runtime's default `<pre>` conversion so a
 * script code block (DESIGN.md §8: a fence whose meta carries a
 * `{name=...}` attribute group) renders as a collapsed, expandable
 * `ScriptMarker` instead of a raw `<pre><code>` wall. Reads the raw hast
 * node (passed via `toJsxRuntime`'s `passNode` option) purely to reach the
 * `data-mk-meta` string `@markii/core`'s `toHast` stashed on the nested
 * `<code>` element — meta is otherwise dropped by the default hast
 * conversion — and reuses `@markii/core`'s own `parseMetaAttributes` to
 * read it, rather than re-implementing the brace/quote/token grammar here.
 * Never throws: any malformed/unparsable meta, or a code block with no
 * `name` attribute at all, falls through to ordinary `<pre>{children}</pre>`
 * rendering — the same graceful-degradation spirit as the unknown-directive
 * fallback (Architecture rule 3).
 */
function PreElement({ node, children }: PreElementProps): ReactElement {
  try {
    const codeNode = findChildElement(node, 'code');
    const meta = codeNode?.properties[CODE_META_ATTR];
    if (typeof meta === 'string') {
      const attrs = parseMetaAttributes(meta);
      const name = attrs.name;
      if (name) {
        return (
          <ScriptMarker
            name={name}
            lang={getLanguage(codeNode)}
            src={attrs.src || undefined}
            code={getCodeText(codeNode)}
            open={Object.hasOwn(attrs, OPEN_ATTRIBUTE_KEY)}
          />
        );
      }
    }
  } catch {
    // Malformed meta degrades to ordinary code-block rendering below —
    // script detection must never be able to break rendering.
  }
  return <pre>{children}</pre>;
}

/**
 * Renders Super Markdown text to a React element tree using `registry` to
 * resolve directive names. Pipeline: `@markii/core`'s `toHast` (parse -> tag
 * directive nodes -> remark-rehype -> sanitize URLs) -> hast-util-to-jsx-runtime
 * (React elements), with directive elements swapped for registry components
 * (or the unknown-directive fallback) along the way. Never throws: parsing
 * is tolerant by construction, and unresolved directive names always render
 * a fallback rather than fail.
 *
 * `store` is the note's value store (`@markii/runtime`, §8's pure read
 * path) — optional, matching how a missing/absent value degrades
 * gracefully rather than failing: with no store, `:value[name]` renders its
 * missing-value marker and every `data=name` attribute resolves to
 * `dataStatus: 'missing'`, but the document still renders completely.
 * Threaded as a plain function argument (not a wrapping React context
 * provider) to match `registry`, the entry point's other piece of
 * configuration — `renderSmd` is a plain function called directly to
 * produce a `ReactElement`, not a component mounted inside its own tree, so
 * there is no existing provider layer for a context to hook into here.
 */
export function renderSmd(
  text: string,
  registry: Registry,
  store?: ValueStore,
): ReactElement {
  try {
    const hastTree = toHast(text);
    const DirectiveElement = createDirectiveElement(registry, store);
    return toJsxRuntime(hastTree, {
      Fragment,
      jsx,
      jsxs,
      passNode: true,
      components: { 'mk-directive': DirectiveElement, pre: PreElement },
    }) as ReactElement;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="mk-unknown mk-unknown--block" role="alert">
        <p className="mk-unknown__label">failed to render document</p>
        <pre className="mk-unknown__content">{message}</pre>
      </div>
    );
  }
}
