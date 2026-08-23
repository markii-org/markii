import {
  toHast,
  nodeToHast,
  parseMetaAttributes,
  isValidScriptName,
  isBareAttribute,
} from '@markii/core';
import type { MarkNode } from '@markii/core';
import { toHtml } from 'hast-util-to-html';
import type { Root, RootContent, ElementContent, Element } from 'hast';
import type {
  DirectiveAttributes,
  HtmlRegistry,
  HtmlRegistryEntry,
  HtmlRenderContext,
} from './registry.js';
import { readRegistryComponent, resolveDirectiveAlias } from './registry.js';
import { resolveLayoutAttributes } from './layout.js';
import { escapeHtml } from './escape.js';

/** The hast tag name `@markii/core`'s `toHast` marks every directive with (`to-hast.ts`'s `DIRECTIVE_TAG`). */
const DIRECTIVE_TAG = 'mk-directive';
/** `data-mk-kind` value for a TEXT (inline) directive; the other two kinds (`leafDirective`/`containerDirective`) are block. */
const TEXT_DIRECTIVE_KIND = 'textDirective';
/** The reserved built-in for render-time value interpolation (§8: `:value[name]`). */
const VALUE_DIRECTIVE_NAME = 'value';
/** The one attribute key that binds a directive to the value store rather than passing through (§8: `data=name`). */
const DATA_ATTRIBUTE_KEY = 'data';
/** The attribute `@markii/core` preserves a code fence's raw `meta` string onto (`to-hast.ts`'s `preserveCodeMeta`). */
const CODE_META_ATTR = 'data-mk-meta';
/** The bare-only meta attribute that opens a script marker expanded (§8; bare-only, fail-closed). */
const OPEN_ATTRIBUTE_KEY = 'open';

/** A hast `raw` node: not in the standard `hast` content unions, but `hast-util-to-html` emits its value verbatim under `allowDangerousHtml`. */
interface RawNode {
  type: 'raw';
  value: string;
}

/**
 * Wraps a finished HTML string as a hast `raw` node. Every directive, script
 * marker, and fallback the engine produces re-enters the tree this way, so a
 * single `toHtml` pass serializes the plain hast around them while their
 * already-built HTML passes through untouched.
 */
function raw(value: string): RootContent {
  return { type: 'raw', value } as unknown as RootContent;
}

/** Serializes a run of (already-transformed) hast content to an HTML string, passing `raw` nodes through verbatim. */
function serialize(children: RootContent[]): string {
  const root: Root = { type: 'root', children };
  return toHtml(root, { allowDangerousHtml: true });
}

const ctx: HtmlRenderContext = { esc: escapeHtml };

/** Parses the `data-mk-attrs` JSON back into an attribute map, keeping only string/null values. Never throws. */
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

/** A directive property read back as a string, or `undefined` if absent or non-string. */
function stringProperty(element: Element, name: string): string | undefined {
  const value = element.properties?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether `entry` is a BLOCK component written inline (docs/spec.md's
 * one-directional form/kind mismatch). Only an explicit `inline: false`
 * counts; a throwing `inline` getter fails permissive, identical to an absent
 * flag, so hostile registry configuration can never throw out of the render.
 */
function isFormMismatch(
  entry: HtmlRegistryEntry,
  kind: string | undefined,
): boolean {
  if (kind !== TEXT_DIRECTIVE_KIND) return false;
  try {
    return entry.inline === false;
  } catch {
    return false;
  }
}

/** The `data=` key is intercepted (like `width`/`align`) so a component never receives it as a raw attribute. */
function stripDataAttribute(
  attributes: DirectiveAttributes,
): DirectiveAttributes {
  if (!Object.hasOwn(attributes, DATA_ATTRIBUTE_KEY)) return attributes;
  const { [DATA_ATTRIBUTE_KEY]: _dropped, ...rest } = attributes;
  return rest;
}

/** The fallback label line, worded for the reason and the form the directive was written in. Returns HTML. */
function fallbackLabel(
  name: string,
  inline: boolean,
  reason: 'unregistered' | 'form-mismatch',
): string {
  const code = `<code>${escapeHtml(name)}</code>`;
  if (reason === 'form-mismatch') {
    return inline
      ? `block component ${code} written inline`
      : `inline component ${code} written as a block`;
  }
  return `unknown component ${code}`;
}

/**
 * The unknown-directive fallback, matching `@markii/react`'s `UnknownDirective`
 * markup and class names byte-for-byte so one stylesheet covers both renderers.
 * An inline directive is built from `<span>`s (it lives inside a paragraph); a
 * block directive gets the dashed `<div>` box with its inner content preserved.
 */
function unknownDirective(
  name: string,
  inline: boolean,
  childrenHtml: string,
  reason: 'unregistered' | 'form-mismatch',
): string {
  const reasonClass = reason === 'form-mismatch' ? ' mk-unknown--mismatch' : '';
  const label = fallbackLabel(name, inline, reason);
  if (inline) {
    return (
      `<span class="mk-unknown mk-unknown--inline${reasonClass}">` +
      `<span class="mk-unknown__label">${label}</span>` +
      `${childrenHtml}</span>`
    );
  }
  const content = childrenHtml
    ? `<div class="mk-unknown__content">${childrenHtml}</div>`
    : '';
  return (
    `<div class="mk-unknown mk-unknown--block${reasonClass}">` +
    `<p class="mk-unknown__label">${label}</p>${content}</div>`
  );
}

/**
 * A registered component that threw while rendering. `@markii/react` lets a
 * third-party component's throw reach the host's error boundary; a string
 * engine has none, so a throw is contained here to a neutral box rather than
 * failing the whole document. Never advertised as "unknown" (it is registered)
 * and never dumps the error text into the page (cleanliness principle).
 */
function componentError(
  name: string,
  inline: boolean,
  childrenHtml: string,
): string {
  const code = `<code>${escapeHtml(name)}</code>`;
  if (inline) {
    return (
      `<span class="mk-unknown mk-unknown--inline mk-unknown--error">` +
      `<span class="mk-unknown__label">component ${code} failed to render</span>` +
      `${childrenHtml}</span>`
    );
  }
  const content = childrenHtml
    ? `<div class="mk-unknown__content">${childrenHtml}</div>`
    : '';
  return (
    `<div class="mk-unknown mk-unknown--block mk-unknown--error">` +
    `<p class="mk-unknown__label">component ${code} failed to render</p>` +
    `${content}</div>`
  );
}

/**
 * The `:value[name]` built-in. Slice 1 has no value store, so every binding is
 * the missing marker (`@markii/react`'s `ValueDirective` renders exactly this
 * for a missing resolution): `{name}` inside a `mk-value mk-value--missing`
 * span. `childrenHtml` is the directive's label, already escaped. Data
 * resolution against a real store arrives with the scripting slice.
 */
function valueMarker(childrenHtml: string): string {
  const label = childrenHtml.trim() ? childrenHtml : 'value';
  return `<span class="mk-value mk-value--missing">{${label}}</span>`;
}

/** The first element child of `node` named `tagName`, or `undefined`. */
function findChildElement(node: Element, tagName: string): Element | undefined {
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName === tagName) return child;
  }
  return undefined;
}

/** The fence's `language-<lang>` tag from a `<code>` element's class list, or `''`. */
function getLanguage(codeNode: Element | undefined): string {
  const className = codeNode?.properties?.className;
  const list = Array.isArray(className) ? className : [];
  for (const name of list) {
    if (typeof name === 'string' && name.startsWith('language-')) {
      return name.slice('language-'.length);
    }
  }
  return '';
}

/** The exact fence body text from a `<code>` element's text children, minus the single trailing newline mdast-util-to-hast appends. */
function getCodeText(codeNode: Element | undefined): string {
  if (!codeNode) return '';
  let text = '';
  for (const child of codeNode.children) {
    if (child.type === 'text') text += child.value;
  }
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * Folds a script code block (a fence whose meta carries `{name=...}` with a
 * valid script name) into a collapsed `<details>` marker, matching
 * `@markii/react`'s `ScriptMarker` markup. Returns `undefined` for any other
 * `<pre>` so the caller serializes it as an ordinary code block. Never throws.
 */
function renderScriptMarker(node: Element): string | undefined {
  try {
    const codeNode = findChildElement(node, 'code');
    const meta = codeNode
      ? (codeNode.properties?.[CODE_META_ATTR] ?? undefined)
      : undefined;
    if (typeof meta !== 'string') return undefined;
    const attrs = parseMetaAttributes(meta);
    const name = attrs.name;
    if (!name || !isValidScriptName(name)) return undefined;

    const src = attrs.src || undefined;
    const detail = src ?? getLanguage(codeNode);
    const summary = detail ? `⚙ ${name} · ${detail}` : `⚙ ${name}`;
    const open = isBareAttribute(meta, OPEN_ATTRIBUTE_KEY);
    const code = getCodeText(codeNode);

    const body = code
      ? `<pre class="mk-script__code"><code>${escapeHtml(code)}</code></pre>`
      : `<p class="mk-script__empty">${
          src ? `source: ${escapeHtml(src)}` : 'no inline body'
        }</p>`;

    return (
      `<details class="mk-script"${open ? ' open' : ''}>` +
      `<summary class="mk-script__summary">${escapeHtml(summary)}</summary>` +
      `${body}</details>`
    );
  } catch {
    return undefined;
  }
}

/** Resolves one directive (registry component, `:value[...]`, or the fallback) given its layout-stripped attributes. Never throws. */
function renderDirectiveContent(
  name: string,
  kind: string | undefined,
  attributes: DirectiveAttributes,
  childrenHtml: string,
  registry: HtmlRegistry,
): string {
  if (name === VALUE_DIRECTIVE_NAME) return valueMarker(childrenHtml);

  const inline = kind === TEXT_DIRECTIVE_KIND;
  const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;
  const component = readRegistryComponent(entry);

  if (!entry || component == null) {
    return unknownDirective(
      name || '(unnamed)',
      inline,
      childrenHtml,
      'unregistered',
    );
  }
  if (isFormMismatch(entry, kind)) {
    return unknownDirective(
      name || '(unnamed)',
      inline,
      childrenHtml,
      'form-mismatch',
    );
  }

  try {
    return component(stripDataAttribute(attributes), childrenHtml, ctx);
  } catch {
    return componentError(name || '(unnamed)', inline, childrenHtml);
  }
}

/** Turns one `<mk-directive>` element (children already transformed) into its HTML string, including the layout wrapper for block directives. */
function renderDirective(element: Element, registry: HtmlRegistry): string {
  const written = stringProperty(element, 'data-mk-name') ?? '';
  const kind = stringProperty(element, 'data-mk-kind');
  const rawAttributes = parseAttributes(
    stringProperty(element, 'data-mk-attrs'),
  );
  const childrenHtml = serialize(element.children as unknown as RootContent[]);

  const { name, attributes: aliased } =
    written === VALUE_DIRECTIVE_NAME
      ? { name: written, attributes: rawAttributes }
      : resolveDirectiveAlias(registry, written, rawAttributes);

  const isBlock = kind !== TEXT_DIRECTIVE_KIND;
  const { attributes, className } = resolveLayoutAttributes(aliased);
  const content = renderDirectiveContent(
    name,
    kind,
    attributes,
    childrenHtml,
    registry,
  );

  return isBlock && className
    ? `<div class="${escapeHtml(className)}">${content}</div>`
    : content;
}

/**
 * Post-order tree transform: every `<mk-directive>` and every script `<pre>`
 * is replaced by a `raw` node carrying its finished HTML, and every other
 * element is left in place with its children transformed. A single `serialize`
 * pass afterward emits the whole tree. Directives are processed after their
 * children so a nested directive is already resolved by the time its parent
 * serializes it.
 */
function makeTransform(
  registry: HtmlRegistry,
): (node: RootContent) => RootContent {
  function transform(node: RootContent): RootContent {
    if (node.type !== 'element') return node;

    node.children = node.children.map(
      (child) => transform(child as RootContent) as unknown as ElementContent,
    );

    if (node.tagName === DIRECTIVE_TAG)
      return raw(renderDirective(node, registry));
    if (node.tagName === 'pre') {
      const marker = renderScriptMarker(node);
      if (marker !== undefined) return raw(marker);
    }
    return node;
  }
  return transform;
}

/** The shared "failed to render" fallback box, matching `@markii/react`'s. Never itself throws. */
function renderFailureFallback(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    `<div class="mk-unknown mk-unknown--block" role="alert">` +
    `<p class="mk-unknown__label">failed to render document</p>` +
    `<pre class="mk-unknown__content">${escapeHtml(message)}</pre></div>`
  );
}

function renderRoot(root: Root, registry: HtmlRegistry): string {
  const transform = makeTransform(registry);
  root.children = root.children.map(transform);
  return serialize(root.children);
}

/**
 * Renders Markii text to a static HTML string using `registry` to resolve
 * directive names. Pipeline: `@markii/core`'s `toHast` (parse -> tag directive
 * nodes -> remark-rehype -> sanitize URLs) -> a hast->HTML walk that swaps
 * directive elements for registry components (or the unknown-directive
 * fallback) and folds script fences into markers. Pure and never-throwing:
 * parsing is tolerant, unknown names always render a fallback, and any
 * unexpected internal error degrades to the "failed to render document" box.
 */
export function renderMarkToHtml(text: string, registry: HtmlRegistry): string {
  try {
    return renderRoot(toHast(text), registry);
  } catch (error) {
    return renderFailureFallback(error);
  }
}

/**
 * The block-level twin of `renderMarkToHtml`: renders one already-parsed mdast
 * node (`@markii/core`'s `MarkNode`) to HTML instead of a whole document's
 * text, via `nodeToHast`. Same registry resolution, same fallbacks, same
 * purity and never-throw guarantees.
 */
export function renderMarkNodeToHtml(
  node: MarkNode,
  registry: HtmlRegistry,
): string {
  try {
    return renderRoot(nodeToHast(node), registry);
  } catch (error) {
    return renderFailureFallback(error);
  }
}
