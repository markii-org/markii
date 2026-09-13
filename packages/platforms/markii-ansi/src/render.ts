import {
  parse,
  toHast,
  nodeToHast,
  isSafeUrl,
  parseMetaAttributes,
  isValidScriptName,
} from '@markii/core';
import type { MarkNode } from '@markii/core';
import type { Root, RootContent, ElementContent, Element } from 'hast';
import {
  bold,
  dim,
  hyperlink,
  inverse,
  italic,
  resolveColorOption,
  underline,
  type ColorLevel,
  type ColorOption,
} from './ansi.js';
import { style } from './style.js';
import { defaultAnsiTheme, type AnsiTheme } from './theme.js';
import { columns, frame, pad, rule, wrap, type FrameOptions } from './box.js';
import { measure } from './measure.js';
import {
  sanitizeBlockText,
  sanitizeUrlText,
  stripControlCharacters,
} from './sanitize.js';
import type {
  AnsiChildPart,
  AnsiChildren,
  AnsiChildrenOptions,
  AnsiRegistry,
  AnsiRegistryEntry,
  AnsiRenderContext,
  DirectiveAttributes,
  ValueResolution,
} from './registry.js';
import {
  readRegistryComponent,
  registryLayoutAxis,
  registrySelfLayout,
  resolveDirectiveAlias,
} from './registry.js';
import {
  applyLayout,
  resolveLayoutAttributes,
  type ResolvedLayoutPresets,
} from './layout.js';
import { resolveScopedPath, type ValueScope } from './resolve.js';
import {
  dataStateSuffix,
  emptyInlineTitle,
  failureToken,
  invalidAttributeValueLabel,
  invalidAttributeValueTitle,
} from './failure-presentation.js';
import {
  formatValue,
  getContract,
  reportDiagnostic,
  type OnDiagnostic,
} from '@markii/stdlib';
import {
  resolveImageAttribute,
  type ResolveImageSrc,
} from './image-resolve.js';
import { resolveHrefAttribute, type ResolveHref } from './href-resolve.js';
import type { AnsiValueStore, AnsiVaultStore } from './value-types.js';
import { defaultAnsiRegistry } from './components/index.js';
import { drawTableGrid } from './components/table-grid.js';

/**
 * The hast walk for the terminal engine, mirroring `@markii/html`'s
 * `render.ts` structure closely enough that a reader of one can read the
 * other: the same directive-resolution pipeline (alias, layout, data
 * binding, form mismatch, invalid-enum notice, empty-inline notice,
 * never-throw component containment), applied to a WIDTH-AWARE plain-text
 * output instead of an HTML string.
 *
 * The one structural difference `@markii/html` does not have: wrapping is
 * not free here. A browser reflows HTML at whatever width the viewport
 * gives it; a terminal line is fixed the moment this engine emits it. Every
 * block-rendering function below therefore takes an explicit `width`
 * (columns available) and, for a directive, an `indent` (the prefix an
 * enclosing block has already applied), and produces its OWN wrapped lines
 * rather than leaving wrapping to something downstream.
 *
 * Interactive components have no meaning in a terminal: `@markii/stdlib`'s
 * `INTERACTIVE_ATTRIBUTE` marks an element a host should treat as a live
 * control (a script-marker `<summary>`, say); this engine has no notion of
 * a live control at all, so it never reads that attribute and never emits
 * a marker for it — there is nothing to degrade, unlike a genuine failure.
 */

/** The hast tag name `@markii/core` marks every directive with. */
const DIRECTIVE_TAG = 'mk-directive';
/** `data-mk-kind` value for a TEXT (inline) directive; the other two kinds are block. */
const TEXT_DIRECTIVE_KIND = 'textDirective';
/** The reserved built-in for render-time value interpolation (docs/spec.md §8). */
const VALUE_DIRECTIVE_NAME = 'value';
/** The one attribute key that binds a directive to the value store. */
const DATA_ATTRIBUTE_KEY = 'data';
/** The attribute `@markii/core` preserves a code fence's raw `meta` string onto. */
const CODE_META_ATTR = 'data-mk-meta';

/** Block-level hast tags this engine recognizes; anything else inside a directive's children is treated as inline content. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'hr',
  'table',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

type MarkRoot = ReturnType<typeof parse>;

function isMarkRoot(node: MarkNode | MarkRoot): node is MarkRoot {
  return (node as { type?: unknown }).type === 'root';
}

function nodeOrRootToHast(node: MarkNode | MarkRoot): Root {
  if (!isMarkRoot(node)) return nodeToHast(node);
  const children: Root['children'] = [];
  for (const child of node.children) {
    children.push(...nodeToHast(child).children);
  }
  return { type: 'root', children };
}

/** Everything one render call shares: the registry, the value scope, and the resolved color/theme/hooks. Never mutated after creation. */
interface WalkContext {
  registry: AnsiRegistry;
  scope: ValueScope;
  color: ColorLevel;
  theme: AnsiTheme;
  resolveImageSrc: ResolveImageSrc | undefined;
  resolveHref: ResolveHref | undefined;
  onDiagnostic: OnDiagnostic | undefined;
}

/** A directive property read back as a string, or `undefined` if absent or non-string. */
function stringProperty(element: Element, name: string): string | undefined {
  const value = element.properties?.[name];
  return typeof value === 'string' ? value : undefined;
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

/** Flattens a directive's inner hast children back to plain text, for `:value[name]`'s label (only top-level TEXT nodes contribute). */
function extractPlainText(children: ElementContent[]): string {
  let text = '';
  for (const child of children) {
    if (child.type === 'text') text += child.value;
  }
  return text;
}

/** Whether `entry` is a BLOCK component written inline. Fails permissive on a throwing `inline` getter. */
function isFormMismatch(
  entry: AnsiRegistryEntry,
  kind: string | undefined,
): boolean {
  if (kind !== TEXT_DIRECTIVE_KIND) return false;
  try {
    return entry.inline === false;
  } catch {
    return false;
  }
}

/** Whether `entry` is registered `inline: true`, read the same hostile-configuration-safe way. */
function isRegisteredInline(entry: AnsiRegistryEntry): boolean {
  try {
    return entry.inline === true;
  } catch {
    return false;
  }
}

/** The fallback label line, worded for the reason and the form the directive was written in. Plain text (no escapes). */
function fallbackLabel(
  name: string,
  inline: boolean,
  reason: 'unregistered' | 'form-mismatch',
): string {
  const code = `\`${stripControlCharacters(name)}\``;
  if (reason === 'form-mismatch') {
    return inline
      ? `block component ${code} written inline`
      : `inline component ${code} written as a block`;
  }
  return `unknown component ${code}`;
}

/**
 * Renders `children`'s default (whole-body) text, never throwing. Used only
 * on already-exceptional paths (an unregistered directive, a form mismatch,
 * a component that itself threw): the render walk underneath `children` is
 * documented never-throw, but these three call sites are exactly the ones
 * built to contain a failure, so they must not become a new way to produce
 * one themselves.
 */
function safeChildrenText(children: AnsiChildren): string {
  try {
    return children();
  } catch {
    return '';
  }
}

/** The unknown-directive fallback: dim inline text for a text directive, a dashed dim frame for a block directive. Wording matches `@markii/html`'s `fallbackLabel` exactly. */
function unknownDirective(
  name: string,
  inline: boolean,
  childrenText: string,
  reason: 'unregistered' | 'form-mismatch',
  width: number,
  color: ColorLevel,
): string {
  const label = fallbackLabel(name, inline, reason);
  // The label and the passed-through content need a visible boundary. The
  // HTML and React engines get one from the fallback's own styling, which a
  // terminal cannot rely on: with color off there is nothing at all between
  // the two, so the label runs straight into the author's words. A colon is
  // the separator, and only when there is content to separate.
  if (inline) {
    return childrenText === ''
      ? dim(label, color)
      : `${dim(`${label}:`, color)} ${childrenText}`;
  }

  const innerWidth = Math.max(1, width - 4);
  const wrappedChildren = childrenText
    ? childrenText
        .split('\n')
        .flatMap((line) => wrap(line, innerWidth))
        .join('\n')
    : '';
  const body = wrappedChildren ? `${label}\n\n${wrappedChildren}` : label;
  return dim(frame(body, { style: 'dashed', width }), color);
}

/** A registered component that threw while rendering, contained to a neutral box rather than failing the whole document. Never dumps the error text. */
function componentError(
  name: string,
  inline: boolean,
  childrenText: string,
  width: number,
  color: ColorLevel,
): string {
  const label = `component \`${stripControlCharacters(name)}\` failed to render`;
  // Same boundary rule as `unknownDirective`'s inline branch above.
  if (inline) {
    return childrenText === ''
      ? dim(label, color)
      : `${dim(`${label}:`, color)} ${childrenText}`;
  }
  return dim(frame(label, { style: 'dashed', width }), color);
}

interface ResolvedDataBinding {
  attributes: DirectiveAttributes;
  data?: unknown;
  dataStatus?: ValueResolution['status'];
  dataError?: string;
  dataFailureKind?: ValueResolution['failureKind'];
}

/** Splits a `data=<name>` attribute off `attributes` and resolves it against `scope`. Never throws. Mirrors `@markii/html`'s `resolveDataAttribute`. */
function resolveDataAttribute(
  attributes: DirectiveAttributes,
  scope: ValueScope,
): ResolvedDataBinding {
  if (!Object.hasOwn(attributes, DATA_ATTRIBUTE_KEY)) return { attributes };

  const { [DATA_ATTRIBUTE_KEY]: rawName, ...rest } = attributes;
  if (!rawName)
    return { attributes: rest, data: undefined, dataStatus: 'missing' };

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

/** Whether one of `name`'s `@markii/stdlib` contract attributes with a closed `enum` is present with a value outside it. Mirrors `@markii/html`'s identical check. */
function invalidEnumAttribute(
  name: string,
  attributes: DirectiveAttributes,
): { attribute: string; value: string } | undefined {
  const contract = getContract(name);
  if (!contract) return undefined;
  for (const [attribute, schema] of Object.entries(contract.attributes)) {
    const enumValues = schema.enum;
    if (!enumValues) continue;
    const value = attributes[attribute];
    if (value === undefined || value === null || value === '') continue;
    if (!enumValues.includes(value)) return { attribute, value };
  }
  return undefined;
}

/** Resolves a `data=`/`:value[]` name against `scope`. Never throws. */
function resolveValue(scope: ValueScope, name: string): ValueResolution {
  const trimmed = name.trim();
  if (!trimmed) return { value: undefined, status: 'missing' };
  return resolveScopedPath(scope, trimmed);
}

/**
 * Builds the missing/stale/resolved marker text for a resolved value name.
 * A plain miss (no error attached) shows only the `{name}` placeholder —
 * there is nothing more to say. An `'error'` status, or a stale value, gets
 * `failure-presentation.ts`'s `dataStateSuffix` appended as visible trailing
 * text: a terminal has no tooltip channel, so the reason has to reach the
 * text itself (AGENTS.md's "clean is not silent").
 */
function renderValueMarker(
  name: string,
  resolved: ValueResolution,
  format: string | undefined,
  decimals: string | undefined,
  color: ColorLevel,
  theme: AnsiTheme,
): string {
  if (resolved.status === 'missing' || resolved.status === 'error') {
    const failureKind =
      resolved.status === 'error' ? resolved.failureKind : undefined;
    const label = name ? `{${stripControlCharacters(name)}}` : '{value}';
    const token = failureToken(failureKind);
    const styled = token
      ? style(label, token, theme, color)
      : dim(label, color);
    const suffix =
      resolved.status === 'error' ? dataStateSuffix('error', failureKind) : '';
    return suffix ? `${styled}${dim(suffix, color)}` : styled;
  }

  const text = stripControlCharacters(
    formatValue(resolved.value, format, decimals),
  );
  const styled = resolved.status === 'stale' ? underline(text, color) : text;
  const suffix =
    resolved.status === 'stale' ? dataStateSuffix('stale', undefined) : '';
  return suffix ? `${styled}${dim(suffix, color)}` : styled;
}

/** Builds the `AnsiRenderContext` handed to one component invocation. */
function buildComponentContext(
  width: number,
  indent: string,
  wctx: WalkContext,
  binding: ResolvedDataBinding,
  layout: ResolvedLayoutPresets | undefined,
): AnsiRenderContext {
  const { color, theme, scope } = wctx;
  const ctx: AnsiRenderContext = {
    width,
    indent,
    color,
    theme,
    style: (text, token) => style(text, token, theme, color),
    bold: (text) => bold(text, color),
    dim: (text) => dim(text, color),
    italic: (text) => italic(text, color),
    underline: (text) => underline(text, color),
    inverse: (text) => inverse(text, color),
    wrap: (text, w) => wrap(text, w),
    pad: (text, w, align) => pad(text, w, align),
    columns: (blocks, widths, gutter) => columns(blocks, widths, gutter),
    frame: (
      block,
      options: { style: 'solid' | 'dashed'; title?: string; width: number },
    ) => frame(block, options as FrameOptions),
    rule: (w, char) => rule(w, char),
    text: (value) => stripControlCharacters(value),
    resolve: (name) => resolveValue(scope, name),
    valueMarker: (name, format, decimals) => {
      const trimmed = name.trim();
      const resolved = trimmed
        ? resolveScopedPath(scope, trimmed)
        : ({ value: undefined, status: 'missing' } as ValueResolution);
      return renderValueMarker(
        trimmed,
        resolved,
        format,
        decimals,
        color,
        theme,
      );
    },
    resolveImageSrc: wctx.resolveImageSrc,
    resolveHref: wctx.resolveHref,
    onDiagnostic: wctx.onDiagnostic,
  };
  if ('data' in binding) {
    ctx.data = binding.data;
    ctx.dataStatus = binding.dataStatus;
    ctx.dataError = binding.dataError;
    ctx.dataFailureKind = binding.dataFailureKind;
  }
  if (layout) ctx.layout = layout;
  return ctx;
}

/** Resolves one directive (registry component, `:value[...]`, or a fallback), given its layout-stripped attributes. Never throws. */
function renderDirectiveContent(
  name: string,
  kind: string | undefined,
  isBlock: boolean,
  attributes: DirectiveAttributes,
  children: AnsiChildren,
  width: number,
  indent: string,
  wctx: WalkContext,
  layoutForComponent: ResolvedLayoutPresets | undefined,
): string {
  const inline = !isBlock;
  const entry = Object.hasOwn(wctx.registry, name)
    ? wctx.registry[name]
    : undefined;
  const component = readRegistryComponent(entry);

  if (!entry || component == null) {
    return unknownDirective(
      name || '(unnamed)',
      inline,
      safeChildrenText(children),
      'unregistered',
      width,
      wctx.color,
    );
  }
  if (isFormMismatch(entry, kind)) {
    return unknownDirective(
      name || '(unnamed)',
      inline,
      safeChildrenText(children),
      'form-mismatch',
      width,
      wctx.color,
    );
  }

  const binding = resolveDataAttribute(attributes, wctx.scope);
  const ctx = buildComponentContext(
    width,
    indent,
    wctx,
    binding,
    layoutForComponent,
  );
  let rendered: string;
  try {
    rendered = component(binding.attributes, children, ctx);
  } catch {
    return componentError(
      name || '(unnamed)',
      inline,
      safeChildrenText(children),
      width,
      wctx.color,
    );
  }

  // The silent-value-drop mechanism (AGENTS.md "clean is not silent"): a
  // known attribute's value outside its closed enum still renders the
  // component exactly as registered, with a short labeled marker appended
  // (there is no tooltip channel in a terminal, so the full reason cannot
  // live inline without becoming body text again). The full sentence is
  // reported to `onDiagnostic` for a host's own diagnostics surface; a
  // caller that passes no `onDiagnostic` simply gets the marker with no
  // reason anywhere, exactly like the browser engines with no tooltip read.
  //
  // A block component's marker goes on its OWN line. Appended to the same
  // line it would land against the bottom edge of whatever the component
  // drew, turning a clean box into a box with a label stuck to its corner.
  // Only an inline component, which is already part of a line of text,
  // takes the marker inline.
  const markerSeparator = inline ? ' ' : '\n';
  const invalidEnum = invalidEnumAttribute(name, binding.attributes);
  if (invalidEnum) {
    reportDiagnostic(wctx.onDiagnostic, {
      kind: 'invalid-attribute-value',
      directive: name,
      attribute: invalidEnum.attribute,
      message: invalidAttributeValueTitle(
        name,
        invalidEnum.attribute,
        invalidEnum.value,
      ),
    });
    const label = invalidAttributeValueLabel(name, invalidEnum.attribute);
    rendered = `${rendered}${markerSeparator}${dim(`[${label}]`, wctx.color)}`;
  }

  // An `inline: true` component with no content still renders exactly as
  // registered, with the same quiet trailing marker.
  if (isRegisteredInline(entry) && safeChildrenText(children).trim() === '') {
    rendered = `${rendered}${dim(` (${emptyInlineTitle(name)})`, wctx.color)}`;
  }

  return rendered;
}

/** Whether `children` reads as block-level content (a container directive's body) rather than inline/phrasing content (a leaf directive's body). */
function isBlockLevelChildren(children: ElementContent[]): boolean {
  for (const child of children) {
    if (child.type !== 'element') continue;
    if (BLOCK_TAGS.has(child.tagName)) return true;
    if (child.tagName === DIRECTIVE_TAG) {
      const kind = stringProperty(child, 'data-mk-kind');
      if (kind !== TEXT_DIRECTIVE_KIND) return true;
    }
  }
  return false;
}

function renderDirectiveChildren(
  children: ElementContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (isBlockLevelChildren(children)) {
    return renderBlocks(children as RootContent[], width, indent, wctx);
  }
  return renderInlineChildren(children, width, indent, wctx);
}

/** The resolved directive name for a `<mk-directive>` element, after alias resolution — the name `AnsiChildPart.name` reports. Attributes play no part in identifying a child this way, so an empty attribute map is enough. */
function resolvedChildDirectiveName(
  element: Element,
  registry: AnsiRegistry,
): string {
  const written = stringProperty(element, 'data-mk-name') ?? '';
  return resolveDirectiveAlias(registry, written, {}).name;
}

/**
 * Builds one `AnsiChildPart` per top-level child of a directive's BLOCK
 * body (a pure whitespace-only text node between blocks, the same kind
 * `renderBlocks` already treats as carrying no content, contributes no
 * part). Each part renders lazily via the same per-node `renderBlock` the
 * ordinary block walk uses, so a container that calls `part.render` at its
 * own chosen width gets exactly what a document-level render at that width
 * would have produced — no separate rendering path to drift from the
 * ordinary one.
 */
function buildBlockChildParts(
  nodes: ElementContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): AnsiChildPart[] {
  const parts: AnsiChildPart[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && node.value.trim() === '') continue;
    const name =
      node.type === 'element' && node.tagName === DIRECTIVE_TAG
        ? resolvedChildDirectiveName(node, wctx.registry)
        : undefined;
    parts.push({
      name,
      render: (options) =>
        renderBlock(
          node as RootContent,
          options?.width ?? width,
          options?.indent ?? indent,
          wctx,
        ),
    });
  }
  return parts;
}

/**
 * Builds the `AnsiChildren` handle a component receives (`registry.ts`'s
 * doc comment on the type): calling it renders the WHOLE body, lazily, at
 * an optionally narrower width/indent; `.parts` exposes each top-level
 * child separately for a container (`row`) that must size each one before
 * it is drawn. Nothing under `element` is rendered until a caller actually
 * invokes one of these functions.
 */
function buildChildren(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): AnsiChildren {
  const isBlock = isBlockLevelChildren(element.children);

  const fn = ((options?: AnsiChildrenOptions): string =>
    renderDirectiveChildren(
      element.children,
      options?.width ?? width,
      options?.indent ?? indent,
      wctx,
    )) as AnsiChildren;

  Object.defineProperty(fn, 'parts', {
    enumerable: true,
    get: (): readonly AnsiChildPart[] =>
      isBlock
        ? buildBlockChildParts(element.children, width, indent, wctx)
        : [
            {
              render: (options?: AnsiChildrenOptions) =>
                renderInlineChildren(
                  element.children,
                  options?.width ?? width,
                  options?.indent ?? indent,
                  wctx,
                ),
            },
          ],
  });

  return fn;
}

/** Turns one `<mk-directive>` element into its rendered text, including the layout adjustment for a block directive whose layout it does not own. */
function renderDirective(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const written = stringProperty(element, 'data-mk-name') ?? '';
  const kind = stringProperty(element, 'data-mk-kind');
  const rawAttributes = parseAttributes(
    stringProperty(element, 'data-mk-attrs'),
  );
  const isBlock = kind !== TEXT_DIRECTIVE_KIND;

  if (written === VALUE_DIRECTIVE_NAME) {
    const plainLabel = extractPlainText(element.children);
    const resolved = resolveValue(wctx.scope, plainLabel);
    return renderValueMarker(
      plainLabel.trim(),
      resolved,
      rawAttributes.format ?? undefined,
      rawAttributes.decimals ?? undefined,
      wctx.color,
      wctx.theme,
    );
  }

  const { name, attributes: aliased } = resolveDirectiveAlias(
    wctx.registry,
    written,
    rawAttributes,
  );
  const ownedAxis = registryLayoutAxis(wctx.registry, name);
  const { attributes, resolved: layoutResolved } = resolveLayoutAttributes(
    aliased,
    isBlock ? ownedAxis : undefined,
  );
  const isLayoutScope = ownedAxis !== undefined && isBlock;
  // A `selfLayout` component (a box-drawing standard component: card,
  // callout, table, chart) also owns applying its own width/align — see
  // `registry.ts`'s `AnsiRegistryEntry.selfLayout` doc comment for why the
  // generic post-render `applyLayout` below would corrupt its frame.
  const isSelfLayout = isBlock && registrySelfLayout(wctx.registry, name);

  const children = buildChildren(element, width, indent, wctx);
  const content = renderDirectiveContent(
    name,
    kind,
    isBlock,
    attributes,
    children,
    width,
    indent,
    wctx,
    isLayoutScope || isSelfLayout ? layoutResolved : undefined,
  );

  if (isBlock && layoutResolved && !isLayoutScope && !isSelfLayout) {
    return applyLayout(content, layoutResolved, width);
  }
  return content;
}

/** The plain text content of an element's descendants, sanitized (used for inline `<code>`, which never carries nested styling). */
function getPlainText(node: Element): string {
  let text = '';
  for (const child of node.children) {
    if (child.type === 'text') text += stripControlCharacters(child.value);
    else if (child.type === 'element') text += getPlainText(child);
  }
  return text;
}

/**
 * A link renders as an OSC 8 hyperlink ONLY when: the color level allows
 * escapes at all, `@markii/core`'s `isSafeUrl` accepts the (resolved)
 * href, AND `./sanitize.js`'s `sanitizeUrlText` leaves the href UNCHANGED —
 * that last check is the one that refuses a href carrying a BEL, ESC, or
 * space rather than silently embedding a sanitized-down version of it,
 * matching this module's `hyperlink.probe.test.ts`. Anything else falls
 * back to plain text: the URL once, if the link's own text already IS the
 * URL, otherwise the text followed by `(url)`.
 */
function renderLink(
  node: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const hrefRaw =
    typeof node.properties?.href === 'string' ? node.properties.href : '';
  const resolvedHref = resolveHrefAttribute(hrefRaw, wctx.resolveHref);
  const text = renderInlineChildren(node.children, width, indent, wctx);
  const sanitizedHref = stripControlCharacters(resolvedHref);

  const canHyperlink =
    wctx.color !== 'none' &&
    resolvedHref.trim() !== '' &&
    isSafeUrl(resolvedHref) &&
    sanitizeUrlText(resolvedHref) === resolvedHref;
  if (canHyperlink) return hyperlink(text, resolvedHref, wctx.color);

  const plainText = text.replace(
    /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*\x07/g,
    '',
  );
  if (plainText === sanitizedHref) return sanitizedHref;
  return `${text} (${sanitizedHref})`;
}

function renderImage(node: Element, wctx: WalkContext): string {
  const altRaw =
    typeof node.properties?.alt === 'string' ? node.properties.alt : '';
  const alt = stripControlCharacters(altRaw);
  const srcRaw =
    typeof node.properties?.src === 'string' ? node.properties.src : '';
  const resolvedSrc = resolveImageAttribute(srcRaw, wctx.resolveImageSrc);
  const src = stripControlCharacters(resolvedSrc);
  return `[${alt}] (${src})`;
}

function renderInlineNode(
  node: ElementContent,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (node.type === 'text') return stripControlCharacters(node.value);
  if (node.type !== 'element') return '';

  switch (node.tagName) {
    case DIRECTIVE_TAG:
      return renderDirective(node, width, indent, wctx);
    case 'strong':
      return bold(
        renderInlineChildren(node.children, width, indent, wctx),
        wctx.color,
      );
    case 'em':
      return italic(
        renderInlineChildren(node.children, width, indent, wctx),
        wctx.color,
      );
    case 'del':
      return dim(
        `~${renderInlineChildren(node.children, width, indent, wctx)}~`,
        wctx.color,
      );
    case 'code': {
      const inner = getPlainText(node);
      return wctx.color === 'none'
        ? dim(inner, wctx.color)
        : inverse(inner, wctx.color);
    }
    case 'a':
      return renderLink(node, width, indent, wctx);
    case 'img':
      return renderImage(node, wctx);
    case 'br':
      return '\n';
    case 'input':
      // Task-list checkboxes are consumed by `renderListItem`; a stray one
      // (outside a list item) produces nothing rather than leaking markup.
      return '';
    default:
      return renderInlineChildren(node.children ?? [], width, indent, wctx);
  }
}

function renderInlineChildren(
  children: ElementContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  let result = '';
  for (const child of children)
    result += renderInlineNode(child, width, indent, wctx);
  return result;
}

function renderHeading(
  el: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const level = Number(el.tagName.slice(1));
  const text = renderInlineChildren(el.children, width, indent, wctx);
  const styled =
    level === 1
      ? underline(bold(text, wctx.color), wctx.color)
      : bold(text, wctx.color);
  return wrap(styled, width).join('\n');
}

function renderParagraph(
  el: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const text = renderInlineChildren(el.children, width, indent, wctx);
  return wrap(text, width).join('\n');
}

function renderBlockquote(
  el: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const innerWidth = Math.max(1, width - 2);
  const inner = renderBlocks(
    el.children as RootContent[],
    innerWidth,
    `${indent}│ `,
    wctx,
  );
  const prefix = dim('│ ', wctx.color);
  return inner
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

/** The task-checkbox state of a list item, or `undefined` for an ordinary item. */
function taskState(li: Element): { checked: boolean } | undefined {
  for (const child of li.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'input') {
      return { checked: Boolean(child.properties?.checked) };
    }
    // A task checkbox is always the first element in `remark-gfm`'s output;
    // any other element first means this is not a task item.
    return undefined;
  }
  return undefined;
}

function renderListItem(
  li: Element,
  marker: string,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const task = taskState(li);
  const contentChildren = li.children.filter(
    (child) => !(task && child.type === 'element' && child.tagName === 'input'),
  );
  const nestedLists: Element[] = [];
  const restChildren: ElementContent[] = [];
  for (const child of contentChildren) {
    if (
      child.type === 'element' &&
      (child.tagName === 'ul' || child.tagName === 'ol')
    ) {
      nestedLists.push(child);
    } else {
      restChildren.push(child);
    }
  }

  const prefix = `${marker}${task ? (task.checked ? '[x] ' : '[ ] ') : ''}`;
  const prefixWidth = measure(prefix);
  const bodyWidth = Math.max(1, width - prefixWidth);
  const bodyText = isBlockLevelChildren(restChildren)
    ? renderBlocks(
        restChildren as RootContent[],
        bodyWidth,
        `${indent}${' '.repeat(prefixWidth)}`,
        wctx,
      )
    : wrap(
        renderInlineChildren(restChildren, bodyWidth, indent, wctx),
        bodyWidth,
      ).join('\n');
  const bodyLines = bodyText === '' ? [''] : bodyText.split('\n');
  const firstLine = `${prefix}${bodyLines[0] ?? ''}`;
  const restLines = bodyLines
    .slice(1)
    .map((line) => `${' '.repeat(prefixWidth)}${line}`);
  let result = [firstLine, ...restLines].join('\n');

  for (const nested of nestedLists) {
    const nestedText = renderBlock(
      nested,
      Math.max(1, width - 2),
      `${indent}  `,
      wctx,
    );
    result += `\n${nestedText
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`;
  }
  return result;
}

function renderList(
  el: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const ordered = el.tagName === 'ol';
  const startRaw = el.properties?.start;
  const start = ordered && typeof startRaw === 'number' ? startRaw : 1;
  const items = el.children.filter(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'li',
  );
  return items
    .map((li, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      return renderListItem(li, marker, width, indent, wctx);
    })
    .join('\n');
}

function findChildElement(node: Element, tagName: string): Element | undefined {
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName === tagName) return child;
  }
  return undefined;
}

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

function getCodeText(codeNode: Element | undefined): string {
  if (!codeNode) return '';
  let text = '';
  for (const child of codeNode.children) {
    if (child.type === 'text') text += child.value;
  }
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * Folds a script code block into a one-line collapsed marker, matching
 * `@markii/html`'s `renderScriptMarker` summary wording exactly (a
 * terminal has no expand/collapse affordance, so the body is never shown —
 * see this module's top comment on interactive components). Returns
 * `undefined` for any other `<pre>` so the caller renders it as an
 * ordinary code block.
 */
function renderScriptMarker(
  node: Element,
  color: ColorLevel,
): string | undefined {
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
    return dim(summary, color);
  } catch {
    return undefined;
  }
}

function renderCodeBlock(node: Element, color: ColorLevel): string {
  const codeNode = findChildElement(node, 'code');
  const language = getLanguage(codeNode);
  const text = sanitizeBlockText(getCodeText(codeNode));
  const lines: string[] = [];
  if (language) lines.push(dim(` ${language}`, color));
  for (const line of text.split('\n')) lines.push(dim(`    ${line}`, color));
  return lines.join('\n');
}

/**
 * An ordinary GFM markdown table, box-drawn with a bold header row through
 * `./components/table-grid.js`'s `drawTableGrid` — the SAME box-drawing and
 * width-negotiation routine the data-bound `::table` component
 * (`./components/table.ts`) draws with, so this engine has exactly one
 * table-drawing implementation rather than two. Rendered at the directive's
 * real available `width`, not a hardcoded budget: each cell's inline
 * markdown is rendered once at that width so its own links/emphasis/code
 * are preserved, and `drawTableGrid` then negotiates how much of `width`
 * each column actually gets.
 */
function renderTable(
  tableEl: Element,
  width: number,
  wctx: WalkContext,
): string {
  const headerCells: string[] = [];
  const bodyRows: string[][] = [];
  let sawHeader = false;

  const collectRow = (tr: Element, into: string[]) => {
    for (const cell of tr.children) {
      if (cell.type !== 'element') continue;
      if (cell.tagName !== 'td' && cell.tagName !== 'th') continue;
      into.push(renderInlineChildren(cell.children, width, '', wctx));
    }
  };

  for (const section of tableEl.children) {
    if (section.type !== 'element') continue;
    const rows: Element[] =
      section.tagName === 'thead' || section.tagName === 'tbody'
        ? section.children.filter(
            (row): row is Element =>
              row.type === 'element' && row.tagName === 'tr',
          )
        : section.tagName === 'tr'
          ? [section]
          : [];
    for (const tr of rows) {
      if (section.tagName === 'thead' && !sawHeader) {
        collectRow(tr, headerCells);
        sawHeader = true;
      } else {
        const row: string[] = [];
        collectRow(tr, row);
        bodyRows.push(row);
      }
    }
  }

  return drawTableGrid(
    headerCells.length > 0 ? headerCells : undefined,
    bodyRows,
    width,
    (text) => bold(text, wctx.color),
  );
}

function renderBlock(
  node: RootContent,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (node.type === 'text') return stripControlCharacters(node.value);
  if (node.type !== 'element') return '';

  if (node.tagName === DIRECTIVE_TAG)
    return renderDirective(node, width, indent, wctx);
  if (/^h[1-6]$/.test(node.tagName))
    return renderHeading(node, width, indent, wctx);
  if (node.tagName === 'p') return renderParagraph(node, width, indent, wctx);
  if (node.tagName === 'blockquote')
    return renderBlockquote(node, width, indent, wctx);
  if (node.tagName === 'ul' || node.tagName === 'ol')
    return renderList(node, width, indent, wctx);
  if (node.tagName === 'hr') return dim(rule(width), wctx.color);
  if (node.tagName === 'table') return renderTable(node, width, wctx);
  if (node.tagName === 'pre') {
    const marker = renderScriptMarker(node, wctx.color);
    if (marker !== undefined) return marker;
    return renderCodeBlock(node, wctx.color);
  }
  return wrap(
    renderInlineChildren(node.children ?? [], width, indent, wctx),
    width,
  ).join('\n');
}

function renderBlocks(
  nodes: RootContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const blocks: string[] = [];
  for (const node of nodes) {
    const rendered = renderBlock(node, width, indent, wctx);
    // Whitespace-only output is dropped, not just the empty string.
    // remark-rehype puts a formatting `\n` TEXT node between every pair of
    // block elements, and `stripControlCharacters` turns a line feed into a
    // space rather than deleting it (see its doc comment: inline text reads
    // better that way). Kept, each of those would become a block of its own
    // holding one space, so every pair of real blocks would be separated by
    // a blank line, a space line, and another blank line instead of a single
    // blank line. Nothing a reader can see is ever lost by this test: a
    // block whose entire rendered form is whitespace carries no content.
    if (rendered.trim() !== '') blocks.push(rendered);
  }
  return blocks.join('\n\n');
}

/** Collapses trailing blank lines to exactly one terminating `\n`, and leaves an empty document as `''`. */
function finalizeOutput(text: string): string {
  if (text === '') return '';
  return `${text.replace(/\n+$/, '')}\n`;
}

/** The shared "failed to render" fallback: one quiet dim line naming the failure, plus the message on its own line. Never a stack trace. */
function renderFailureFallback(error: unknown, color: ColorLevel): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${dim('failed to render document', color)}\n${stripControlCharacters(message)}\n`;
}

function renderRoot(
  root: Root,
  registry: AnsiRegistry,
  scope: ValueScope,
  color: ColorLevel,
  theme: AnsiTheme,
  resolveImageSrc: ResolveImageSrc | undefined,
  resolveHref: ResolveHref | undefined,
  onDiagnostic: OnDiagnostic | undefined,
  width: number,
): string {
  const wctx: WalkContext = {
    registry,
    scope,
    color,
    theme,
    resolveImageSrc,
    resolveHref,
    onDiagnostic,
  };
  return finalizeOutput(renderBlocks(root.children, width, '', wctx));
}

/** The columns assumed when a caller supplies no `width` option. */
const DEFAULT_WIDTH = 80;

/**
 * Options for `renderMarkToAnsi`/`renderMarkNodeToAnsi`/`renderMarkInlineToAnsi`.
 * `store`/`vault` are offered both here and as positional parameters; when
 * both are given, the option wins (matching `@markii/html`'s
 * `RenderMarkOptions`).
 */
export interface RenderMarkOptions {
  readonly width?: number;
  readonly color?: ColorOption;
  readonly theme?: AnsiTheme;
  readonly resolveImageSrc?: ResolveImageSrc;
  readonly resolveHref?: ResolveHref;
  readonly onDiagnostic?: OnDiagnostic;
  readonly store?: AnsiValueStore;
  readonly vault?: AnsiVaultStore;
}

/**
 * Renders Markii text to a plain string (optionally carrying ANSI SGR/OSC 8
 * escapes) using `registry` to resolve directive names. `registry` is
 * OPTIONAL here, unlike the other two engines' required parameter, and
 * defaults to `defaultAnsiRegistry` (empty in this phase; every directive
 * therefore renders the unknown-component fallback).
 *
 * Pipeline: `@markii/core`'s `toHast` (parse -> tag directive nodes ->
 * remark-rehype -> sanitize URLs) -> a width-aware hast walk that swaps
 * directive elements for registry components (or the unknown-directive
 * fallback), folds script fences into a one-line marker, and wraps every
 * paragraph, heading, and list item to `options.width` (default 80). Pure
 * and never-throwing: parsing is tolerant, unknown names always render a
 * fallback, and any unexpected internal error degrades to the "failed to
 * render document" line.
 *
 * `options.color` resolves via `./ansi.js`'s `resolveColorOption`: `'auto'`
 * and `undefined` both mean "no escapes" here, since this engine has no
 * environment knowledge of its own — a caller that wants automatic
 * detection calls `detectColorLevel` itself and passes the result as
 * `'16'`/`'256'`/`'truecolor'`.
 *
 * `store`/`vault` and `resolveImageSrc`/`resolveHref`/`onDiagnostic` carry
 * the same meaning as `@markii/html`'s identical options.
 */
export function renderMarkToAnsi(
  text: string,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): string {
  const color = resolveColorOption(options?.color);
  try {
    return renderRoot(
      toHast(text),
      registry,
      { store: options?.store ?? store, vault: options?.vault ?? vault },
      color,
      options?.theme ?? defaultAnsiTheme,
      options?.resolveImageSrc,
      options?.resolveHref,
      options?.onDiagnostic,
      options?.width ?? DEFAULT_WIDTH,
    );
  } catch (error) {
    return renderFailureFallback(error, color);
  }
}

/**
 * The block-level twin of `renderMarkToAnsi`: renders one already-parsed
 * mdast node OR a whole already-parsed mdast document (`@markii/core`'s
 * `MarkNode`, or the `Root` `parse` itself returns) instead of raw document
 * text. Same registry resolution, same fallbacks, same purity and
 * never-throw guarantees, same options.
 */
export function renderMarkNodeToAnsi(
  node: MarkNode | MarkRoot,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): string {
  const color = resolveColorOption(options?.color);
  try {
    return renderRoot(
      nodeOrRootToHast(node),
      registry,
      { store: options?.store ?? store, vault: options?.vault ?? vault },
      color,
      options?.theme ?? defaultAnsiTheme,
      options?.resolveImageSrc,
      options?.resolveHref,
      options?.onDiagnostic,
      options?.width ?? DEFAULT_WIDTH,
    );
  } catch (error) {
    return renderFailureFallback(error, color);
  }
}

/** Whether `root` is exactly one paragraph holding exactly one text directive (`:name[...]`) and nothing else. Mirrors `@markii/html`'s identical `loneInlineDirective`. */
function loneInlineDirective(root: MarkRoot): MarkNode | undefined {
  if (root.children.length !== 1) return undefined;
  const [only] = root.children;
  if (!only || only.type !== 'paragraph') return undefined;
  if (only.children.length !== 1) return undefined;
  const [inner] = only.children;
  return inner && (inner as { type?: unknown }).type === 'textDirective'
    ? (inner as unknown as MarkNode)
    : undefined;
}

/**
 * Renders `text` as a single, standalone inline directive when that is all
 * it is, mirroring `@markii/html`'s identical `renderMarkInlineToHtml`: a
 * source whose only parsed block is a paragraph holding exactly one text
 * directive renders that directive alone. Any other source falls back to
 * the exact same rendering `renderMarkToAnsi` would produce.
 */
export function renderMarkInlineToAnsi(
  text: string,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): string {
  try {
    const root = parse(text);
    const lone = loneInlineDirective(root);
    if (lone) {
      return renderMarkNodeToAnsi(lone, registry, store, vault, options);
    }
  } catch {
    // Falls through to the ordinary whole-document render below.
  }
  return renderMarkToAnsi(text, registry, store, vault, options);
}
