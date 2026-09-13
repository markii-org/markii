import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Box, Text } from 'ink';
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
  carrySgrAcrossLines,
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
import {
  frameBlock,
  measureWidth,
  padText,
  ruleLine,
  wrapText,
} from './text-grid.js';
import { drawTableGrid } from './components/table-grid.js';
import { resolveRowLayout } from './components/row.js';
import { resolveCardInnerWidth } from './components/card.js';
import { resolveCalloutInnerWidth } from './components/callout.js';
import { resolveDetailsInnerWidth } from './components/details-string.js';
import {
  sanitizeBlockText,
  sanitizeUrlText,
  stripControlCharacters,
} from './sanitize.js';
import type {
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
import { renderInkToString } from './ink-string.js';
import { InteractiveRoot } from './interactive.js';
import type { FocusableDescriptor } from './interactive.js';
import { InteractiveTabs } from './components/tabs.js';
import { InteractiveDetails } from './components/details.js';

/**
 * The hast walk for the terminal engine (batch 10: the Ink rewrite). Every
 * DECISION this walk makes is unchanged from the pre-Ink engine (alias
 * resolution, layout resolution, data binding, form mismatch, invalid-enum
 * notice, empty-inline notice, never-throw component containment, script-
 * fence markers, link and image handling) — see AGENTS.md's architecture
 * rules and the batch-10 brief. What changed is the OUTPUT shape: instead of
 * building one big plain string, the walk builds a tree of Ink elements
 * (`Box`/`Text`) and hands it to `ink-string.ts` (the render-once path) or
 * returns it directly (the new live-viewer export, `buildMarkElement`).
 *
 * Two rendering "modes" coexist deliberately, and BOTH still exist in the
 * pre-Ink engine's shape:
 *
 * - STRING mode (`render*String` functions below): the pre-Ink algorithm,
 *   almost verbatim, still building one flattened, pre-wrapped, pre-aligned
 *   string. This is what every standard component's OWN body still uses —
 *   `card` frames a string, `callout` bars a string, `details` indents a
 *   string — because these components draw FIXED-WIDTH GLYPHS that must be
 *   correct the moment the string is built; Ink lays a tree out AFTER it is
 *   built, so it cannot reflow a box-drawing frame or re-justify per-line
 *   text alignment the way `text=center` needs (Ink has no per-line
 *   paragraph-justify primitive). String mode is also the ONLY mode inline
 *   content ever uses, at any nesting depth: an inline directive's body is
 *   phrasing content by definition (docs/spec.md), never a layout the reader
 *   would want Ink to lay out as boxes.
 * - ELEMENT mode (`render*Element` functions below): real Ink elements,
 *   used for the document's own block sequencing (so ordinary prose wraps
 *   through Ink's own layout instead of this engine's manual `wrap()`) and
 *   for the three block directives that genuinely need Ink's real layout or
 *   real component state: `row` (a flex `Box` row instead of the deleted
 *   `columns()` string helper), `tabs` and `details` (real React state, for
 *   `ctx.interactive`'s keyboard-driven switching/toggling). A `row`/`tabs`/
 *   `details` reached through a STRING-mode ancestor (nested inside `card`,
 *   `callout`, `figure`, a standalone `cell`, or a GFM table cell) falls
 *   back to a flattened STRING rendering of itself with no interactivity —
 *   an accepted, documented boundary: a self-drawing container's body is, by
 *   its own nature, a fixed string, so nothing nested inside one can be
 *   live. See this file's `renderRowString`/`renderTabsString` for that
 *   fallback.
 *
 * Interactive components have no meaning for a NON-interactive render at
 * all: `@markii/stdlib`'s `INTERACTIVE_ATTRIBUTE` marks an element a HOST
 * should treat as a live control (a script-marker `<summary>`, say); this
 * engine never reads that attribute and never emits a marker for it.
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
/** The three block directive names given real Ink layout/state (see this file's top comment). */
const ROW_NAME = 'row';
const TABS_NAME = 'tabs';
const DETAILS_NAME = 'details';

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

/** Everything one render call shares: the registry, the value scope, and the resolved color/theme/hooks. Never mutated after creation, except `focusCounter` (sequential focus ids) and `focusables` (their descriptors for the status line), both of which only the counting walk in `buildMarkElement` populates. */
interface WalkContext {
  registry: AnsiRegistry;
  scope: ValueScope;
  color: ColorLevel;
  theme: AnsiTheme;
  interactive: boolean;
  resolveImageSrc: ResolveImageSrc | undefined;
  resolveHref: ResolveHref | undefined;
  onDiagnostic: OnDiagnostic | undefined;
  focusCounter: { current: number };
  /** Populated only by `buildMarkElement`'s counting walk; `undefined` for every other walk (string rendering, the mounted render's own tree), which have no use for it and skip the bookkeeping. */
  focusables: FocusableDescriptor[] | undefined;
}

function nextFocusId(wctx: WalkContext): number {
  const id = wctx.focusCounter.current;
  wctx.focusCounter.current += 1;
  return id;
}

/** Records `descriptor` for `focusId` when `wctx` is collecting them (a no-op otherwise). Call sites push in the same order they call `nextFocusId`, so `focusId` always equals the descriptor's index. */
function recordFocusable(
  wctx: WalkContext,
  descriptor: FocusableDescriptor,
): void {
  wctx.focusables?.push(descriptor);
}

/**
 * The ONE place a STRING built by this file's string engine becomes an Ink
 * `<Text>` leaf. Every such string passes through `ansi.js`'s
 * `carrySgrAcrossLines` first — see that function's doc comment for why:
 * Ink resets SGR state at every embedded line boundary within one `<Text>`
 * value, so a multi-line styled string (a dim-wrapped frame, a wrapped
 * bold heading, a paragraph whose bold span straddled a wrap point) must
 * have every physical line already self-contained before Ink ever sees it.
 * This is the SYSTEMATIC fix (a single choke point) rather than a per-
 * call-site one: every `<Text>` in this file that renders a plain string
 * uses this, never a bare `<Text>{str}</Text>`.
 */
function styledText(text: string): ReactElement {
  return <Text>{carrySgrAcrossLines(text)}</Text>;
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
  if (inline) {
    return childrenText === ''
      ? dim(label, color)
      : `${dim(`${label}:`, color)} ${childrenText}`;
  }

  const innerWidth = Math.max(1, width - 4);
  const wrappedChildren = childrenText
    ? childrenText
        .split('\n')
        .flatMap((line) => wrapText(line, innerWidth))
        .join('\n')
    : '';
  const body = wrappedChildren ? `${label}\n\n${wrappedChildren}` : label;
  return dim(frameBlock(body, { style: 'dashed', width }), color);
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
  if (inline) {
    return childrenText === ''
      ? dim(label, color)
      : `${dim(`${label}:`, color)} ${childrenText}`;
  }
  return dim(frameBlock(label, { style: 'dashed', width }), color);
}

interface ResolvedDataBinding {
  attributes: DirectiveAttributes;
  data?: unknown;
  dataStatus?: ValueResolution['status'];
  dataError?: string;
  dataFailureKind?: ValueResolution['failureKind'];
}

/** Splits a `data=<name>` attribute off `attributes` and resolves it against `scope`. Never throws. */
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

/** Whether one of `name`'s `@markii/stdlib` contract attributes with a closed `enum` is present with a value outside it. */
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

/** Builds the missing/stale/resolved marker text for a resolved value name. */
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
  focusId: number | undefined,
): AnsiRenderContext {
  const { color, theme, scope } = wctx;
  const ctx: AnsiRenderContext = {
    width,
    indent,
    color,
    theme,
    interactive: wctx.interactive,
    style: (text, token) => style(text, token, theme, color),
    bold: (text) => bold(text, color),
    dim: (text) => dim(text, color),
    italic: (text) => italic(text, color),
    underline: (text) => underline(text, color),
    inverse: (text) => inverse(text, color),
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
  if (focusId !== undefined) ctx.focusId = focusId;
  if ('data' in binding) {
    ctx.data = binding.data;
    ctx.dataStatus = binding.dataStatus;
    ctx.dataError = binding.dataError;
    ctx.dataFailureKind = binding.dataFailureKind;
  }
  if (layout) ctx.layout = layout;
  return ctx;
}

// ---------------------------------------------------------------------------
// STRING MODE — the pre-Ink algorithm. Used for every inline position (at
// any depth) and for a directive's own body once it is not one of the three
// Ink-element-aware directives (`row`/`tabs`/`details`).
// ---------------------------------------------------------------------------

function safeChildrenText(text: string | undefined): string {
  return text ?? '';
}

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

function renderDirectiveContentString(
  name: string,
  kind: string | undefined,
  isBlock: boolean,
  attributes: DirectiveAttributes,
  childrenText: string,
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
      safeChildrenText(childrenText),
      'unregistered',
      width,
      wctx.color,
    );
  }
  if (isFormMismatch(entry, kind)) {
    return unknownDirective(
      name || '(unnamed)',
      inline,
      safeChildrenText(childrenText),
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
    undefined,
  );
  let rendered: string;
  try {
    const result = component({
      attributes: binding.attributes,
      children: childrenText,
      ctx,
    });
    rendered = typeof result === 'string' ? result : String(result ?? '');
  } catch {
    return componentError(
      name || '(unnamed)',
      inline,
      safeChildrenText(childrenText),
      width,
      wctx.color,
    );
  }

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

  if (
    isRegisteredInline(entry) &&
    safeChildrenText(childrenText).trim() === ''
  ) {
    rendered = `${rendered}${dim(` (${emptyInlineTitle(name)})`, wctx.color)}`;
  }

  return rendered;
}

function renderDirectiveChildrenString(
  children: ElementContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (isBlockLevelChildren(children)) {
    return renderBlocksString(children as RootContent[], width, indent, wctx);
  }
  return renderInlineChildrenString(children, width, indent, wctx);
}

function renderRowString(
  element: Element,
  attributes: DirectiveAttributes,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const cellNodes = element.children.filter(
    (node) => !(node.type === 'text' && node.value.trim() === ''),
  );
  const layout = resolveRowLayout(attributes, cellNodes.length, width);
  if (cellNodes.length === 0) return '';

  const place = (text: string, w: number): string =>
    layout.align === 'left'
      ? text
      : text
          .split('\n')
          .map((line) => padText(line, w, layout.align))
          .join('\n');

  if (layout.stacked) {
    return cellNodes
      .map((node) =>
        place(
          renderBlockString(node as RootContent, width, indent, wctx),
          width,
        ),
      )
      .join('\n\n');
  }

  const placedCells = cellNodes.map((node) =>
    place(
      renderBlockString(node as RootContent, layout.colWidth, indent, wctx),
      layout.colWidth,
    ),
  );

  const gridRows: string[] = [];
  for (let index = 0; index < placedCells.length; index += layout.columnCount) {
    const rowCells = placedCells.slice(index, index + layout.columnCount);
    const lineArrays = rowCells.map((cell) => cell.split('\n'));
    const rowHeight = Math.max(0, ...lineArrays.map((lines) => lines.length));
    const lines: string[] = [];
    for (let line = 0; line < rowHeight; line += 1) {
      lines.push(
        lineArrays
          .map((cellLines) =>
            padText(cellLines[line] ?? '', layout.colWidth, 'left'),
          )
          .join(' ')
          .replace(/[ ]+$/, ''),
      );
    }
    gridRows.push(lines.join('\n'));
  }
  return gridRows.join('\n\n');
}

interface TabPanel {
  label: string;
  body: string;
}

const DEFAULT_TAB_LABEL = 'Tab';

/** Extracts each top-level `tab` child's own label attribute and rendered body, used by BOTH the string fallback and the real interactive builder — a structural replacement for the pre-Ink engine's fragile "split the flattened string on a blank line" heuristic. */
function extractTabPanels(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): TabPanel[] {
  const panels: TabPanel[] = [];
  for (const node of element.children) {
    if (node.type === 'text' && node.value.trim() === '') continue;
    if (node.type !== 'element') continue;
    let label = DEFAULT_TAB_LABEL;
    let isTab = false;
    if (node.tagName === DIRECTIVE_TAG) {
      const written = stringProperty(node, 'data-mk-name') ?? '';
      const attrs = parseAttributes(stringProperty(node, 'data-mk-attrs'));
      const { name } = resolveDirectiveAlias(wctx.registry, written, attrs);
      if (name === 'tab') {
        label = attrs.label ?? DEFAULT_TAB_LABEL;
        isTab = true;
      }
    }
    // A `tab` child's own label is drawn ONCE, by the heading `tabs`
    // itself builds below — rendering the whole `tab` directive here (as
    // for any other block) would ALSO invoke `tab.ts`'s own component,
    // which draws its OWN bold heading from the same attribute, printing
    // the label twice. Render only the tab's INNER children instead. A
    // non-`tab` block (an unlabeled panel) still renders as a whole block,
    // unchanged.
    const body = isTab
      ? renderDirectiveChildrenString(node.children, width, indent, wctx)
      : renderBlockString(node as RootContent, width, indent, wctx);
    panels.push({ label, body });
  }
  return panels;
}

const ACTIVE_MARKER = ' (active)';

function renderBlockString(
  node: RootContent,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (node.type === 'text') return stripControlCharacters(node.value);
  if (node.type !== 'element') return '';

  if (node.tagName === DIRECTIVE_TAG) {
    return renderDirectiveString(node, width, indent, wctx);
  }
  if (/^h[1-6]$/.test(node.tagName)) {
    const level = Number(node.tagName.slice(1));
    const text = renderInlineChildrenString(node.children, width, indent, wctx);
    const styled =
      level === 1
        ? underline(bold(text, wctx.color), wctx.color)
        : bold(text, wctx.color);
    return wrapText(styled, width).join('\n');
  }
  if (node.tagName === 'p') {
    return wrapText(
      renderInlineChildrenString(node.children, width, indent, wctx),
      width,
    ).join('\n');
  }
  if (node.tagName === 'blockquote') {
    const innerWidth = Math.max(1, width - 2);
    const inner = renderBlocksString(
      node.children as RootContent[],
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
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    return renderListString(node, width, indent, wctx);
  }
  if (node.tagName === 'hr') return dim(ruleLine(width), wctx.color);
  if (node.tagName === 'table') return renderGfmTableString(node, width, wctx);
  if (node.tagName === 'pre') {
    const marker = renderScriptMarker(node, wctx.color);
    if (marker !== undefined) return marker;
    return renderCodeBlock(node, wctx.color);
  }
  return wrapText(
    renderInlineChildrenString(node.children ?? [], width, indent, wctx),
    width,
  ).join('\n');
}

function taskState(li: Element): { checked: boolean } | undefined {
  for (const child of li.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'input') {
      return { checked: Boolean(child.properties?.checked) };
    }
    return undefined;
  }
  return undefined;
}

function renderListItemString(
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
  const prefixWidth = measureWidth(prefix);
  const bodyWidth = Math.max(1, width - prefixWidth);
  const bodyText = isBlockLevelChildren(restChildren)
    ? renderBlocksString(
        restChildren as RootContent[],
        bodyWidth,
        `${indent}${' '.repeat(prefixWidth)}`,
        wctx,
      )
    : wrapText(
        renderInlineChildrenString(restChildren, bodyWidth, indent, wctx),
        bodyWidth,
      ).join('\n');
  const bodyLines = bodyText === '' ? [''] : bodyText.split('\n');
  const firstLine = `${prefix}${bodyLines[0] ?? ''}`;
  const restLines = bodyLines
    .slice(1)
    .map((line) => `${' '.repeat(prefixWidth)}${line}`);
  let result = [firstLine, ...restLines].join('\n');

  for (const nested of nestedLists) {
    const nestedText = renderBlockString(
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

function renderListString(
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
      return renderListItemString(li, marker, width, indent, wctx);
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

function renderGfmTableString(
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
      into.push(renderInlineChildrenString(cell.children, width, '', wctx));
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

function getPlainText(node: Element): string {
  let text = '';
  for (const child of node.children) {
    if (child.type === 'text') text += stripControlCharacters(child.value);
    else if (child.type === 'element') text += getPlainText(child);
  }
  return text;
}

function renderLink(
  node: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const hrefRaw =
    typeof node.properties?.href === 'string' ? node.properties.href : '';
  const resolvedHref = resolveHrefAttribute(hrefRaw, wctx.resolveHref);
  const text = renderInlineChildrenString(node.children, width, indent, wctx);
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

function renderInlineNodeString(
  node: ElementContent,
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  if (node.type === 'text') return stripControlCharacters(node.value);
  if (node.type !== 'element') return '';

  switch (node.tagName) {
    case DIRECTIVE_TAG:
      return renderDirectiveString(node, width, indent, wctx);
    case 'strong':
      return bold(
        renderInlineChildrenString(node.children, width, indent, wctx),
        wctx.color,
      );
    case 'em':
      return italic(
        renderInlineChildrenString(node.children, width, indent, wctx),
        wctx.color,
      );
    case 'del':
      return dim(
        `~${renderInlineChildrenString(node.children, width, indent, wctx)}~`,
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
      return '';
    default:
      return renderInlineChildrenString(
        node.children ?? [],
        width,
        indent,
        wctx,
      );
  }
}

function renderInlineChildrenString(
  children: ElementContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  let result = '';
  for (const child of children)
    result += renderInlineNodeString(child, width, indent, wctx);
  return result;
}

function renderBlocksString(
  nodes: RootContent[],
  width: number,
  indent: string,
  wctx: WalkContext,
): string {
  const blocks: string[] = [];
  for (const node of nodes) {
    const rendered = renderBlockString(node, width, indent, wctx);
    if (rendered.trim() !== '') blocks.push(rendered);
  }
  return blocks.join('\n\n');
}

function renderDirectiveString(
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

  // A `row`/`tabs` reached through STRING mode (nested inside a self-drawing
  // container's own body) falls back to a flattened rendering with no real
  // flex layout / interactivity — see this file's top comment.
  if (isBlock && name === ROW_NAME && hasRealComponent(wctx.registry, name)) {
    return renderRowString(element, aliased, width, indent, wctx);
  }
  if (isBlock && name === TABS_NAME && hasRealComponent(wctx.registry, name)) {
    const panels = extractTabPanels(element, width, indent, wctx);
    return panels
      .map((panel, index) => {
        const heading = bold(
          `${panel.label}${index === 0 ? ACTIVE_MARKER : ''}`,
          wctx.color,
        );
        return panel.body ? `${heading}\n${panel.body}` : heading;
      })
      .join('\n\n');
  }

  const ownedAxis = registryLayoutAxis(wctx.registry, name);
  const { attributes, resolved: layoutResolved } = resolveLayoutAttributes(
    aliased,
    isBlock ? ownedAxis : undefined,
  );
  const isLayoutScope = ownedAxis !== undefined && isBlock;
  const isSelfLayout = isBlock && registrySelfLayout(wctx.registry, name);
  const layoutForWidth =
    isLayoutScope || isSelfLayout ? layoutResolved : undefined;

  // `card`/`callout`/`details` narrow their own body before drawing a frame
  // or an indent around it. Each computes that inner width from ONLY its
  // own attributes (never from the body), so the walk resolves it here,
  // BEFORE building children, and builds children exactly ONCE at that
  // final width — never at the outer width followed by a re-wrap. A
  // re-wrap-afterward shipped as a real regression (post-phase-2 review):
  // it corrupts anything self-drawing nested inside (a card's frame, a
  // row's columns), since a word-based re-wrapper has no notion that a run
  // of box-drawing characters is not prose. See `resolveCardInnerWidth`'s
  // doc comment.
  let childrenWidth = width;
  if (isBlock && name === 'card') {
    childrenWidth = resolveCardInnerWidth(attributes, layoutForWidth, width);
  } else if (isBlock && name === 'callout') {
    childrenWidth = resolveCalloutInnerWidth(attributes, layoutForWidth, width);
  } else if (isBlock && name === DETAILS_NAME) {
    childrenWidth = resolveDetailsInnerWidth(width);
  }

  const childrenText = renderDirectiveChildrenString(
    element.children,
    childrenWidth,
    indent,
    wctx,
  );
  const content = renderDirectiveContentString(
    name,
    kind,
    isBlock,
    attributes,
    childrenText,
    width,
    indent,
    wctx,
    layoutForWidth,
  );

  if (isBlock && layoutResolved && !isLayoutScope && !isSelfLayout) {
    return applyLayout(content, layoutResolved, width);
  }
  return content;
}

function hasRealComponent(registry: AnsiRegistry, name: string): boolean {
  return (
    Object.hasOwn(registry, name) &&
    readRegistryComponent(registry[name]) != null
  );
}

// ---------------------------------------------------------------------------
// ELEMENT MODE — real Ink elements, used for block sequencing and for
// `row`/`tabs`/`details`. See this file's top comment.
// ---------------------------------------------------------------------------

/** Wraps `element` per `layout`'s resolved width/align, the JSX-based twin of `layout.ts`'s string-based `applyLayout`, for the three directives whose own output is a real Ink element rather than a string. */
function applyLayoutElement(
  element: ReactElement,
  layout: ResolvedLayoutPresets | undefined,
  width: number,
): ReactElement {
  if (!layout) return element;
  let target = width;
  if (layout.width === 'narrow') target = Math.max(20, Math.round(width / 2));
  const align = layout.align;
  const alignItems =
    align === 'center'
      ? 'center'
      : align === 'right'
        ? 'flex-end'
        : 'flex-start';
  if (target === width && !align) return element;
  return (
    <Box width={width} flexDirection="column" alignItems={alignItems}>
      <Box width={target} flexDirection="column">
        {element}
      </Box>
    </Box>
  );
}

function invalidEnumMarkerElement(
  name: string,
  attributes: DirectiveAttributes,
  wctx: WalkContext,
): ReactElement | null {
  const invalidEnum = invalidEnumAttribute(name, attributes);
  if (!invalidEnum) return null;
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
  return styledText(dim(`[${label}]`, wctx.color));
}

function renderRowElement(
  element: Element,
  attributes: DirectiveAttributes,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  const cellNodes = element.children.filter(
    (node) => !(node.type === 'text' && node.value.trim() === ''),
  );
  if (cellNodes.length === 0) return null;
  const layout = resolveRowLayout(attributes, cellNodes.length, width);

  if (layout.stacked) {
    const items = cellNodes
      .map((node, index) => (
        <Box key={index} marginTop={index > 0 ? 1 : 0} flexDirection="column">
          {renderBlockElement(node, width, indent, wctx)}
        </Box>
      ))
      .filter(Boolean);
    return <Box flexDirection="column">{items}</Box>;
  }

  const gutter = 1;
  const rows: ReactElement[] = [];
  for (let index = 0; index < cellNodes.length; index += layout.columnCount) {
    const rowCells = cellNodes.slice(index, index + layout.columnCount);
    rows.push(
      <Box key={index} flexDirection="row" marginTop={index > 0 ? 1 : 0}>
        {rowCells.map((node, cellIndex) => (
          <Box
            key={cellIndex}
            width={layout.colWidth}
            marginRight={cellIndex < rowCells.length - 1 ? gutter : 0}
            flexDirection="column"
          >
            {renderBlockElement(node, layout.colWidth, indent, wctx)}
          </Box>
        ))}
      </Box>,
    );
  }
  return <Box flexDirection="column">{rows}</Box>;
}

function renderTabsElement(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  const panels = extractTabPanelsElement(element, width, indent, wctx);
  if (panels.length === 0) return null;
  const focusId = wctx.interactive ? nextFocusId(wctx) : undefined;
  if (focusId !== undefined) {
    recordFocusable(wctx, {
      kind: 'tabs',
      label: panels[0]?.label ?? DEFAULT_TAB_LABEL,
    });
  }
  return (
    <InteractiveTabs
      panels={panels}
      color={wctx.color}
      interactive={wctx.interactive}
      focusId={focusId}
    />
  );
}

export interface ElementTabPanel {
  label: string;
  body: ReactNode;
}

function extractTabPanelsElement(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): ElementTabPanel[] {
  const panels: ElementTabPanel[] = [];
  for (const node of element.children) {
    if (node.type === 'text' && node.value.trim() === '') continue;
    if (node.type !== 'element') continue;
    let label = DEFAULT_TAB_LABEL;
    let isTab = false;
    if (node.tagName === DIRECTIVE_TAG) {
      const written = stringProperty(node, 'data-mk-name') ?? '';
      const attrs = parseAttributes(stringProperty(node, 'data-mk-attrs'));
      const { name } = resolveDirectiveAlias(wctx.registry, written, attrs);
      if (name === 'tab') {
        label = attrs.label ?? DEFAULT_TAB_LABEL;
        isTab = true;
      }
    }
    // See `extractTabPanels`'s (string-mode) identical comment: rendering
    // the whole `tab` directive here would ALSO invoke `tab.ts`'s own
    // component, printing the label a second time.
    const body = isTab
      ? renderBlocksElement(node.children, width, indent, wctx)
      : renderBlockElement(node, width, indent, wctx);
    panels.push({ label, body });
  }
  return panels;
}

function renderDetailsElement(
  element: Element,
  attributes: DirectiveAttributes,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement {
  const title = attributes.title ?? 'Details';
  const open = Object.hasOwn(attributes, 'open');
  const innerWidth = resolveDetailsInnerWidth(width);
  const body = renderBlocksElement(element.children, innerWidth, indent, wctx);
  const focusId = wctx.interactive ? nextFocusId(wctx) : undefined;
  if (focusId !== undefined) {
    recordFocusable(wctx, {
      kind: 'details',
      label: stripControlCharacters(title),
    });
  }
  return (
    <InteractiveDetails
      title={stripControlCharacters(title)}
      body={body}
      defaultOpen={open}
      color={wctx.color}
      interactive={wctx.interactive}
      focusId={focusId}
    />
  );
}

/** Renders one directive as a real Ink element (block position only). Dispatches `row`/`tabs`/`details` to their real builders; every other directive falls back to the string engine, wrapped in one `<Text>`. */
function renderDirectiveElement(
  element: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  const written = stringProperty(element, 'data-mk-name') ?? '';
  const kind = stringProperty(element, 'data-mk-kind');
  const rawAttributes = parseAttributes(
    stringProperty(element, 'data-mk-attrs'),
  );
  const isBlock = kind !== TEXT_DIRECTIVE_KIND;

  if (!isBlock) {
    // A stray inline (text) directive at a block position (rare; hast
    // structure keeps these inside a paragraph in practice) still renders,
    // via the string engine.
    return styledText(renderDirectiveString(element, width, indent, wctx));
  }

  const { name, attributes: aliased } = resolveDirectiveAlias(
    wctx.registry,
    written,
    rawAttributes,
  );
  const entry = Object.hasOwn(wctx.registry, name)
    ? wctx.registry[name]
    : undefined;
  const formMismatch = entry ? isFormMismatch(entry, kind) : false;

  if (
    !formMismatch &&
    (name === ROW_NAME || name === TABS_NAME || name === DETAILS_NAME) &&
    hasRealComponent(wctx.registry, name)
  ) {
    // None of `row`/`tabs`/`details` own a layout axis (`registryLayoutAxis`
    // is undefined for all three in the standard registry), so, unlike a
    // layout-wrapper scope, a `width=`/`align=` the author wrote still needs
    // the GENERIC post-render treatment — `applyLayoutElement` below, the
    // JSX-based twin of `layout.ts`'s string `applyLayout`.
    const { attributes, resolved: layoutResolved } = resolveLayoutAttributes(
      aliased,
      undefined,
    );
    try {
      let el: ReactElement | null = null;
      if (name === ROW_NAME) {
        el = renderRowElement(element, attributes, width, indent, wctx);
      } else if (name === TABS_NAME) {
        el = renderTabsElement(element, width, indent, wctx);
      } else {
        el = renderDetailsElement(element, attributes, width, indent, wctx);
      }
      if (!el) return null;
      const marker = invalidEnumMarkerElement(name, attributes, wctx);
      const withMarker = marker ? (
        <Box flexDirection="column">
          {el}
          {marker}
        </Box>
      ) : (
        el
      );
      return applyLayoutElement(withMarker, layoutResolved, width);
    } catch {
      return styledText(
        componentError(name || '(unnamed)', false, '', width, wctx.color),
      );
    }
  }

  return styledText(renderDirectiveString(element, width, indent, wctx));
}

/** A block-position hast node, whichever of `hast`'s two (near-identical) content unions it arrived as. `render.tsx` walks both a `Root`'s `children` (`RootContent[]`) and an `Element`'s `children` (`ElementContent[]`) with the same functions, so every element-mode block function accepts either. */
type AnyBlockNode = RootContent | ElementContent;

/** Renders one block-level hast node as a real Ink element, or `null` for a node that carries no content (whitespace-only text). */
function renderBlockElement(
  node: AnyBlockNode,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  if (node.type === 'text') {
    return node.value.trim() === ''
      ? null
      : styledText(stripControlCharacters(node.value));
  }
  if (node.type !== 'element') return null;

  if (node.tagName === DIRECTIVE_TAG) {
    return renderDirectiveElement(node, width, indent, wctx);
  }
  if (node.tagName === 'blockquote') {
    const innerWidth = Math.max(1, width - 2);
    const inner = renderBlocksElement(
      node.children,
      innerWidth,
      `${indent}│ `,
      wctx,
    );
    if (!inner) return null;
    return (
      <Box width={width}>
        {styledText(dim('│ ', wctx.color))}
        <Box flexDirection="column" width={innerWidth}>
          {inner}
        </Box>
      </Box>
    );
  }
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    return renderListElement(node, width, indent, wctx);
  }

  const text = renderBlockString(node, width, indent, wctx);
  if (text.trim() === '') return null;
  return styledText(text);
}

function renderListElement(
  el: Element,
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  const ordered = el.tagName === 'ol';
  const startRaw = el.properties?.start;
  const start = ordered && typeof startRaw === 'number' ? startRaw : 1;
  const items = el.children.filter(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'li',
  );
  if (items.length === 0) return null;

  const items$ = items.map((li, index) => {
    const marker = ordered ? `${start + index}. ` : '- ';
    const task = taskState(li);
    const contentChildren = li.children.filter(
      (child) =>
        !(task && child.type === 'element' && child.tagName === 'input'),
    );
    const prefix = `${marker}${task ? (task.checked ? '[x] ' : '[ ] ') : ''}`;
    const prefixWidth = measureWidth(prefix);
    const bodyWidth = Math.max(1, width - prefixWidth);
    const nestedLists = contentChildren.filter(
      (child) =>
        child.type === 'element' &&
        (child.tagName === 'ul' || child.tagName === 'ol'),
    );
    const restChildren = contentChildren.filter(
      (child) => !nestedLists.includes(child),
    );
    const bodyIsBlock = isBlockLevelChildren(restChildren);
    const bodyText = bodyIsBlock
      ? undefined
      : wrapText(
          renderInlineChildrenString(restChildren, bodyWidth, indent, wctx),
          bodyWidth,
        ).join('\n');
    return (
      <Box key={index} flexDirection="column">
        <Box>
          {styledText(prefix)}
          <Box width={bodyWidth} flexDirection="column">
            {bodyIsBlock
              ? renderBlocksElement(restChildren, bodyWidth, indent, wctx)
              : styledText(bodyText ?? '')}
          </Box>
        </Box>
        {nestedLists.length > 0 && (
          <Box marginLeft={2} flexDirection="column">
            {nestedLists.map((nested, nestedIndex) => (
              <Fragment key={nestedIndex}>
                {renderBlockElement(
                  nested as RootContent,
                  Math.max(1, width - 2),
                  `${indent}  `,
                  wctx,
                )}
              </Fragment>
            ))}
          </Box>
        )}
      </Box>
    );
  });
  return <Box flexDirection="column">{items$}</Box>;
}

/** Renders a sequence of block-level hast nodes as a real Ink element (a column `Box`), one blank row (`marginTop`) between consecutive non-empty blocks — the Ink-element twin of `renderBlocksString`'s `'\n\n'.join`. */
function renderBlocksElement(
  nodes: readonly AnyBlockNode[],
  width: number,
  indent: string,
  wctx: WalkContext,
): ReactElement | null {
  const elements: ReactElement[] = [];
  for (const node of nodes) {
    const el = renderBlockElement(node, width, indent, wctx);
    if (el === null) continue;
    elements.push(
      <Box
        key={elements.length}
        marginTop={elements.length > 0 ? 1 : 0}
        flexDirection="column"
      >
        {el}
      </Box>,
    );
  }
  if (elements.length === 0) return null;
  return <>{elements}</>;
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

function buildWalkContext(
  registry: AnsiRegistry,
  scope: ValueScope,
  color: ColorLevel,
  theme: AnsiTheme,
  interactive: boolean,
  resolveImageSrc: ResolveImageSrc | undefined,
  resolveHref: ResolveHref | undefined,
  onDiagnostic: OnDiagnostic | undefined,
): WalkContext {
  return {
    registry,
    scope,
    color,
    theme,
    interactive,
    resolveImageSrc,
    resolveHref,
    onDiagnostic,
    focusCounter: { current: 0 },
    focusables: undefined,
  };
}

/** The columns assumed when a caller supplies no `width` option. */
const DEFAULT_WIDTH = 80;

/**
 * Options for `renderMarkToAnsi`/`renderMarkNodeToAnsi`/`renderMarkInlineToAnsi`.
 * `store`/`vault` are offered both here and as positional parameters; when
 * both are given, the option wins.
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
  /**
   * Renders the document's CONTENT in interactive shape (tabs show only
   * their active panel, details start closed unless `open`) without
   * actually mounting a live keyboard loop — this render-once path always
   * captures exactly one frame (`ink-string.ts`'s own `interactive: false`
   * Ink render option is a SEPARATE thing; see its doc comment for the
   * name collision). Defaults to `false`: unset, `tabs`/`details` render
   * every panel/always-open exactly as the pre-Ink engine did.
   */
  readonly interactive?: boolean;
}

/** Builds the root Ink element for `root`, given every resolved render input. Exported for `buildMarkElement` (the live-viewer entry point, phase 3) as well as this module's own three string-producing entry points. */
function buildRootElement(
  root: Root,
  registry: AnsiRegistry,
  scope: ValueScope,
  color: ColorLevel,
  theme: AnsiTheme,
  interactive: boolean,
  resolveImageSrc: ResolveImageSrc | undefined,
  resolveHref: ResolveHref | undefined,
  onDiagnostic: OnDiagnostic | undefined,
  width: number,
): ReactElement {
  const wctx = buildWalkContext(
    registry,
    scope,
    color,
    theme,
    interactive,
    resolveImageSrc,
    resolveHref,
    onDiagnostic,
  );
  const body = renderBlocksElement(root.children, width, '', wctx);
  return (
    <Box width={width} flexDirection="column">
      {body ?? <Text> </Text>}
    </Box>
  );
}

async function renderRootToString(
  root: Root,
  registry: AnsiRegistry,
  scope: ValueScope,
  color: ColorLevel,
  theme: AnsiTheme,
  interactive: boolean,
  resolveImageSrc: ResolveImageSrc | undefined,
  resolveHref: ResolveHref | undefined,
  onDiagnostic: OnDiagnostic | undefined,
  width: number,
): Promise<string> {
  const element = buildRootElement(
    root,
    registry,
    scope,
    color,
    theme,
    interactive,
    resolveImageSrc,
    resolveHref,
    onDiagnostic,
    width,
  );
  const raw = await renderInkToString(element, width);
  return finalizeOutput(raw);
}

/**
 * Renders Markii text to a plain string (optionally carrying ANSI SGR/OSC 8
 * escapes) using `registry` to resolve directive names. `registry` is
 * OPTIONAL here, unlike the other two engines' required parameter, and
 * defaults to `defaultAnsiRegistry`.
 *
 * `async` since the first call in a process pays Ink/Yoga's one-time module-
 * evaluation cost (`ink-string.ts`'s doc comment; `SPIKE-10-findings.md`'s
 * "Item 3"). Never throws: parsing is tolerant, unknown names always render
 * a fallback, and any unexpected internal error degrades to the "failed to
 * render document" line.
 *
 * `options.color` resolves via `./ansi.js`'s `resolveColorOption`: `'auto'`
 * and `undefined` both mean "no escapes" here, since this engine has no
 * environment knowledge of its own — a caller that wants automatic
 * detection calls `detectColorLevel` itself and passes the result as
 * `'16'`/`'256'`/`'truecolor'`.
 */
export async function renderMarkToAnsi(
  text: string,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): Promise<string> {
  const color = resolveColorOption(options?.color);
  try {
    return await renderRootToString(
      toHast(text),
      registry,
      { store: options?.store ?? store, vault: options?.vault ?? vault },
      color,
      options?.theme ?? defaultAnsiTheme,
      options?.interactive ?? false,
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
 * mdast node OR a whole already-parsed mdast document instead of raw
 * document text. Same registry resolution, same fallbacks, same purity and
 * never-throw guarantees, same options.
 */
export async function renderMarkNodeToAnsi(
  node: MarkNode | MarkRoot,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): Promise<string> {
  const color = resolveColorOption(options?.color);
  try {
    return await renderRootToString(
      nodeOrRootToHast(node),
      registry,
      { store: options?.store ?? store, vault: options?.vault ?? vault },
      color,
      options?.theme ?? defaultAnsiTheme,
      options?.interactive ?? false,
      options?.resolveImageSrc,
      options?.resolveHref,
      options?.onDiagnostic,
      options?.width ?? DEFAULT_WIDTH,
    );
  } catch (error) {
    return renderFailureFallback(error, color);
  }
}

/** Whether `root` is exactly one paragraph holding exactly one text directive (`:name[...]`) and nothing else. */
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
 * it is. Any other source falls back to the exact same rendering
 * `renderMarkToAnsi` would produce.
 */
export async function renderMarkInlineToAnsi(
  text: string,
  registry: AnsiRegistry = defaultAnsiRegistry,
  store?: AnsiValueStore,
  vault?: AnsiVaultStore,
  options?: RenderMarkOptions,
): Promise<string> {
  try {
    const root = parse(text);
    const lone = loneInlineDirective(root);
    if (lone) {
      return await renderMarkNodeToAnsi(lone, registry, store, vault, options);
    }
  } catch {
    // Falls through to the ordinary whole-document render below.
  }
  return renderMarkToAnsi(text, registry, store, vault, options);
}

/**
 * The live-viewer entry point (phase 3 consumes this): builds the same Ink
 * element tree `renderMarkToAnsi` would render to a string, but returns the
 * element itself so a host (the CLI's `markii view`) can mount it directly
 * with Ink's own `render()` instead of re-rendering a string on every
 * keystroke/resize. `document` accepts raw text OR an already-parsed mdast
 * node/root, mirroring the three string entry points' flexibility.
 */
export function buildMarkElement(
  document: string | MarkNode | MarkRoot,
  registry: AnsiRegistry = defaultAnsiRegistry,
  options?: RenderMarkOptions & {
    readonly onExit?: () => void;
  },
): ReactElement {
  const color = resolveColorOption(options?.color);
  const theme = options?.theme ?? defaultAnsiTheme;
  const scope: ValueScope = { store: options?.store, vault: options?.vault };
  const width = options?.width ?? DEFAULT_WIDTH;
  const interactive = options?.interactive ?? true;

  let root: Root;
  try {
    root =
      typeof document === 'string'
        ? toHast(document)
        : nodeOrRootToHast(document);
  } catch {
    root = { type: 'root', children: [] };
  }

  const content = buildRootElement(
    root,
    registry,
    scope,
    color,
    theme,
    interactive,
    options?.resolveImageSrc,
    options?.resolveHref,
    options?.onDiagnostic,
    width,
  );

  if (!interactive) return content;

  // The walk above already assigned every focusable component's `focusId`
  // (`WalkContext.focusCounter`) and, incidentally, discarded each one's
  // descriptor (`WalkContext.focusables` is left `undefined` on the real
  // render, since nothing there needs it). Rebuilding once more, this time
  // collecting descriptors, is wasteful only in the sense that the tree is
  // constructed twice; simpler and safer than threading mutable state out
  // of a pure element-builder, and this entry point is called once per
  // mount/resize, not per keystroke.
  const counter = { current: 0 };
  const focusables: FocusableDescriptor[] = [];
  const countingWctx = buildWalkContext(
    registry,
    scope,
    color,
    theme,
    true,
    options?.resolveImageSrc,
    options?.resolveHref,
    // No `onDiagnostic`: the real walk above already reported every notice
    // this document produces, and this second walk exists only to collect
    // focus descriptors. Passing the callback here would report each notice
    // twice on every mount and again on every resize.
    undefined,
  );
  countingWctx.focusCounter = counter;
  countingWctx.focusables = focusables;
  renderBlocksElement(root.children, width, '', countingWctx);

  return (
    <InteractiveRoot
      focusables={focusables}
      onExit={options?.onExit}
      color={color}
      theme={theme}
    >
      {content}
    </InteractiveRoot>
  );
}
