import {
  toHast,
  nodeToHast,
  parseMetaAttributes,
  isValidScriptName,
  isBareAttribute,
} from '@markii/core';
import type { MarkNode } from '@markii/core';
import { toHtml } from 'hast-util-to-html';
import type { Root, RootContent, ElementContent, Element, Text } from 'hast';
import type { ValueStore, VaultStore } from '@markii/runtime';
import type {
  DirectiveAttributes,
  HtmlRegistry,
  HtmlRegistryEntry,
  HtmlRenderContext,
  ValueResolution,
} from './registry.js';
import { readRegistryComponent, resolveDirectiveAlias } from './registry.js';
import { resolveLayoutAttributes } from './layout.js';
import { escapeHtml } from './escape.js';
import { resolveScopedPath, type ValueScope } from './resolve.js';
import { failureKindClass, failureTitle } from './failure-presentation.js';
import { stringifyStoredValue } from './value-format.js';

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

/**
 * Wraps a finished HTML string as a hast `raw` node. A `raw` node is not in
 * the standard `hast` content unions, but `hast-util-to-html` emits its value
 * verbatim under `allowDangerousHtml` — so every directive, script marker, and
 * fallback the engine produces re-enters the tree this way, and a single
 * `toHtml` pass serializes the plain hast around them while their already-built
 * HTML passes through untouched.
 */
function raw(value: string): RootContent {
  return { type: 'raw', value } as unknown as RootContent;
}

/** Serializes a run of (already-transformed) hast content to an HTML string, passing `raw` nodes through verbatim. */
function serialize(children: RootContent[]): string {
  const root: Root = { type: 'root', children };
  return toHtml(root, { allowDangerousHtml: true });
}

/**
 * Builds the missing/stale/resolved `<span>` for a resolved value name,
 * matching `@markii/react`'s `ValueDirective` markup and class names
 * byte-for-byte: `mk-value mk-value--missing` (+ a failure-kind modifier
 * class, only for a genuine `'error'` resolution) with `{name}` as the
 * label when nothing resolved; `mk-value` (+ `mk-value--stale`) with the
 * stringified value otherwise. Never throws.
 */
function buildValueMarker(name: string, resolved: ValueResolution): string {
  if (resolved.status === 'missing' || resolved.status === 'error') {
    const failureKind =
      resolved.status === 'error' ? resolved.failureKind : undefined;
    const kindClass = failureKindClass('mk-value', failureKind);
    const className = kindClass
      ? `mk-value mk-value--missing ${kindClass}`
      : 'mk-value mk-value--missing';
    const title = failureTitle(resolved.error, failureKind);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const label = name ? `{${escapeHtml(name)}}` : '{value}';
    return `<span class="${className}"${titleAttr}>${label}</span>`;
  }

  const className =
    resolved.status === 'stale' ? 'mk-value mk-value--stale' : 'mk-value';
  return `<span class="${className}">${escapeHtml(stringifyStoredValue(resolved.value))}</span>`;
}

/**
 * Builds the base `HtmlRenderContext` for one top-level render call, bound
 * to `scope` (the store/vault this render was invoked with). `resolve` and
 * `valueMarker` never throw, matching `resolveScopedPath`'s own contract.
 * The `data*` fields are attached per-directive later (see
 * `withDataBinding`) — this base object never carries them.
 */
function createBaseContext(scope: ValueScope): HtmlRenderContext {
  return {
    esc: escapeHtml,
    resolve(name: string): ValueResolution {
      const trimmed = name.trim();
      if (!trimmed) return { value: undefined, status: 'missing' };
      return resolveScopedPath(scope, trimmed);
    },
    valueMarker(name: string): string {
      const trimmed = name.trim();
      const resolved = trimmed
        ? resolveScopedPath(scope, trimmed)
        : ({ value: undefined, status: 'missing' } as ValueResolution);
      return buildValueMarker(trimmed, resolved);
    },
  };
}

/** `ctx` with one directive's resolved `data=` binding attached, for the single component invocation that binding belongs to. */
function withDataBinding(
  ctx: HtmlRenderContext,
  binding: ResolvedDataBinding,
): HtmlRenderContext {
  if (!('data' in binding)) return ctx;
  return {
    ...ctx,
    data: binding.data,
    dataStatus: binding.dataStatus,
    dataError: binding.dataError,
    dataFailureKind: binding.dataFailureKind,
  };
}

interface ResolvedDataBinding {
  attributes: DirectiveAttributes;
  data?: unknown;
  dataStatus?: ValueResolution['status'];
  dataError?: string;
  dataFailureKind?: ValueResolution['failureKind'];
}

/**
 * Splits a `data=<name>` attribute (if present) off `attributes`, resolves
 * `<name>` against `scope` — dotted paths and `@`-prefixed vault names both
 * work, via `resolveScopedPath` — and returns the resolved binding plus the
 * remaining attributes. Never throws: no store/vault, an empty `data`
 * attribute, or an unresolved path all degrade to `dataStatus: 'missing'`
 * with `data: undefined`. Mirrors `@markii/react`'s `resolveDataAttribute`.
 */
function resolveDataAttribute(
  attributes: DirectiveAttributes,
  scope: ValueScope,
): ResolvedDataBinding {
  if (!Object.hasOwn(attributes, DATA_ATTRIBUTE_KEY)) {
    return { attributes };
  }

  const { [DATA_ATTRIBUTE_KEY]: rawName, ...rest } = attributes;
  if (!rawName) {
    return { attributes: rest, data: undefined, dataStatus: 'missing' };
  }

  const resolved = resolveScopedPath(scope, rawName);
  return {
    attributes: rest,
    data: resolved.value,
    dataStatus: resolved.status,
    dataError: resolved.error,
    dataFailureKind:
      resolved.status === 'error' ? resolved.failureKind : undefined,
  };
}

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
 * Flattens a directive's inner hast children back to plain text, for
 * `:value[name]`'s label (§8: a bare value name). Only top-level TEXT nodes
 * contribute; a nested element (markup the format never asks authors to
 * write inside the label) contributes nothing rather than being partially
 * serialized — mirrors `@markii/react`'s `ValueDirective`'s
 * `extractPlainText`, adapted from a React-children walk to a hast-children
 * walk since this engine never builds a React tree.
 */
function extractPlainText(children: ElementContent[]): string {
  let text = '';
  for (const child of children) {
    if (child.type === 'text') text += (child as Text).value;
  }
  return text;
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
  plainLabel: string,
  registry: HtmlRegistry,
  ctx: HtmlRenderContext,
  scope: ValueScope,
): string {
  if (name === VALUE_DIRECTIVE_NAME) return ctx.valueMarker(plainLabel);

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

  const binding = resolveDataAttribute(attributes, scope);
  try {
    return component(
      binding.attributes,
      childrenHtml,
      withDataBinding(ctx, binding),
    );
  } catch {
    return componentError(name || '(unnamed)', inline, childrenHtml);
  }
}

/** Turns one `<mk-directive>` element (children already transformed) into its HTML string, including the layout wrapper for block directives. */
function renderDirective(
  element: Element,
  registry: HtmlRegistry,
  ctx: HtmlRenderContext,
  scope: ValueScope,
): string {
  const written = stringProperty(element, 'data-mk-name') ?? '';
  const kind = stringProperty(element, 'data-mk-kind');
  const rawAttributes = parseAttributes(
    stringProperty(element, 'data-mk-attrs'),
  );
  const childrenHtml = serialize(element.children as unknown as RootContent[]);
  const plainLabel =
    written === VALUE_DIRECTIVE_NAME ? extractPlainText(element.children) : '';

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
    plainLabel,
    registry,
    ctx,
    scope,
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
  ctx: HtmlRenderContext,
  scope: ValueScope,
): (node: RootContent) => RootContent {
  function transform(node: RootContent): RootContent {
    if (node.type !== 'element') return node;

    node.children = node.children.map(
      (child) => transform(child as RootContent) as unknown as ElementContent,
    );

    if (node.tagName === DIRECTIVE_TAG)
      return raw(renderDirective(node, registry, ctx, scope));
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

function renderRoot(
  root: Root,
  registry: HtmlRegistry,
  scope: ValueScope,
): string {
  const ctx = createBaseContext(scope);
  const transform = makeTransform(registry, ctx, scope);
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
 *
 * `store` is the note's value store (`@markii/runtime`, §8's pure read path)
 * — optional, matching how a missing/absent value degrades gracefully: with
 * no store, `:value[name]` renders its missing-value marker and every
 * `data=name` attribute resolves to `dataStatus: 'missing'`, but the
 * document still renders completely.
 *
 * `vault` is the optional app-scoped read seam (`@markii/runtime`'s
 * `VaultStore`) that an `@`-prefixed name (`data=@gh.stars`,
 * `:value[@gh.stars]`) resolves against instead of `store` — "bare name =
 * mine, `@name` = the vault's". With no `vault` supplied, every `@name`
 * degrades to `'missing'` the same way an absent `store` degrades a bare
 * name.
 */
export function renderMarkToHtml(
  text: string,
  registry: HtmlRegistry,
  store?: ValueStore,
  vault?: VaultStore,
): string {
  try {
    return renderRoot(toHast(text), registry, { store, vault });
  } catch (error) {
    return renderFailureFallback(error);
  }
}

/**
 * The block-level twin of `renderMarkToHtml`: renders one already-parsed mdast
 * node (`@markii/core`'s `MarkNode`) to HTML instead of a whole document's
 * text, via `nodeToHast`. Same registry resolution, same fallbacks, same
 * purity and never-throw guarantees, and the same optional `store`/`vault`
 * value-binding arguments.
 */
export function renderMarkNodeToHtml(
  node: MarkNode,
  registry: HtmlRegistry,
  store?: ValueStore,
  vault?: VaultStore,
): string {
  try {
    return renderRoot(nodeToHast(node), registry, { store, vault });
  } catch (error) {
    return renderFailureFallback(error);
  }
}
