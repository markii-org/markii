/**
 * Directive autocompletion (GitHub issue #27, slice 1): `completionAt` and
 * `hoverAt`, the two entry points a host calls. Pure and host-neutral: no
 * editor API, no knowledge of `vscode` or `obsidian`. Built on top of
 * `./directive-context.ts`'s pure line/column parsing, the insert catalog
 * (`../insert/component-catalog.ts`), and the skeleton builder
 * (`../insert/component-skeleton.ts`) — this module never builds directive
 * text by hand, it reuses that skeleton builder.
 */
import type { PackComponentAttribute } from '@markii/pack';
import type { AttributeSchema, ComponentKind } from '@markii/stdlib';
import {
  LAYOUT_ATTRIBUTES,
  LAYOUT_ATTRIBUTE_KEYS,
  getContract,
} from '@markii/stdlib';
import { componentSkeleton } from '../insert/component-skeleton.js';
import type { ComponentSkeleton } from '../insert/component-skeleton.js';
import type { InsertableComponent } from '../insert/component-catalog.js';
import { firstSentence } from '../insert/first-sentence.js';
import {
  clampColumn,
  findDirectiveNameTokenAt,
  parseCompletionContext,
} from './directive-context.js';
import type {
  AttributeNameParseResult,
  AttributeValueParseResult,
  DirectiveForm,
  DirectiveNameParseResult,
} from './directive-context.js';
import { componentDocumentation } from './documentation.js';
import type { CompletionContext, CompletionItem, HoverInfo } from './types.js';

export type {
  CompletionContext,
  CompletionContextKind,
  CompletionItem,
  CompletionItemKind,
  ComponentDocumentation,
  HoverInfo,
} from './types.js';
export {
  componentDocumentation,
  formatComponentDocumentation,
} from './documentation.js';

const EMPTY_CONTEXT_AT = (column: number): CompletionContext => ({
  kind: 'none',
  replaceStart: column,
  replaceEnd: column,
  items: [],
});

/** Whether `component` is offered when the author is typing directive `form`. A pack component with no declared kind (see `InsertableComponent.kindDeclared`) is offered in every form. */
function componentOffersForm(
  component: InsertableComponent,
  form: DirectiveForm,
): boolean {
  if (!component.kindDeclared) return true;
  return component.kind === form;
}

/**
 * Adjusts a container skeleton's opening/closing fence to use exactly the
 * colon run the user typed (docs/format.md: an outer fence needs more
 * colons than an inner one, e.g. `::::tabs` when nesting). The skeleton's
 * container form is always `:::name{...}\n\n:::` — a fixed three-colon
 * prefix and a fixed three-colon suffix — so swapping both for `colonRun`
 * is a straight slice-and-splice; `cursorOffset` shifts by the same amount
 * the prefix grew, since the cursor always lands before the closing fence.
 */
function adjustContainerFence(
  skeleton: ComponentSkeleton,
  colonRun: string,
): ComponentSkeleton {
  if (colonRun.length === 3) return skeleton;
  const shift = colonRun.length - 3;
  const text =
    colonRun + skeleton.text.slice(3, skeleton.text.length - 3) + colonRun;
  return { text, cursorOffset: skeleton.cursorOffset + shift };
}

function buildSkeleton(
  directiveName: string,
  kind: ComponentKind,
  requiredAttributes: readonly string[],
  colonRun: string,
): ComponentSkeleton {
  const skeleton = componentSkeleton(directiveName, kind, requiredAttributes);
  return kind === 'container'
    ? adjustContainerFence(skeleton, colonRun)
    : skeleton;
}

function directiveNameItem(
  component: InsertableComponent,
  ctx: DirectiveNameParseResult,
  isRestEmpty: boolean,
): CompletionItem {
  let insertText: string;
  let insertCursorOffset: number;

  if (isRestEmpty) {
    // The form the AUTHOR TYPED wins over the catalog's `kind` for a pack
    // component that declared none: `componentOffersForm` above lets such a
    // component through in all three forms, and the catalog's `'container'`
    // is only a default there, not a fact. Building a container skeleton
    // for an author who typed `::` would rewrite their two colons into a
    // broken two-colon fence. For every other component the two agree by
    // construction, since the filter only admits a matching form.
    const kind = component.kindDeclared ? component.kind : ctx.form;
    const skeleton = buildSkeleton(
      component.directiveName,
      kind,
      component.requiredAttributes,
      ctx.colonRun,
    );
    insertText = skeleton.text;
    insertCursorOffset = skeleton.cursorOffset;
  } else {
    insertText = component.directiveName;
    insertCursorOffset = component.directiveName.length;
  }

  return {
    label: component.directiveName,
    kind: 'component',
    detail: component.description ?? '',
    documentation: componentDocumentation(component),
    insertText,
    insertCursorOffset,
    group: component.group,
    ...(component.packName !== undefined
      ? { packName: component.packName }
      : {}),
  };
}

function directiveNameCompletionContext(
  ctx: DirectiveNameParseResult,
  catalog: readonly InsertableComponent[],
  line: string,
): CompletionContext {
  const restOfLine = line.slice(ctx.replaceEnd);
  const isRestEmpty = /^\s*$/.test(restOfLine);
  const replaceStart = isRestEmpty
    ? ctx.replaceStart
    : ctx.replaceStart + ctx.colonRun.length;

  const items = catalog
    .filter((component) => componentOffersForm(component, ctx.form))
    .map((component) => directiveNameItem(component, ctx, isRestEmpty));

  return {
    kind: 'directive-name',
    replaceStart,
    replaceEnd: ctx.replaceEnd,
    items,
  };
}

/** The catalog entry for `directiveName`, matched case-insensitively the same way `hoverAt` matches. */
function findCatalogEntry(
  catalog: readonly InsertableComponent[],
  directiveName: string,
): InsertableComponent | undefined {
  const lowered = directiveName.toLowerCase();
  return catalog.find(
    (component) => component.directiveName.toLowerCase() === lowered,
  );
}

/**
 * The declared attributes of the pack component named `directiveName`, or
 * an empty list when the name is unknown, is a standard component (its
 * attributes come from its contract instead), or declared none.
 *
 * On a block form the two reserved layout attributes are filtered out:
 * `width` and `align` are offered from `@markii/stdlib`'s one layout
 * source a few lines below, so a pack that also declares one of those
 * names would otherwise produce two rows for the same attribute, with
 * different values behind them. An inline directive is never offered the
 * layout attributes at all, so there a declared `width` is the pack's own
 * and passes through.
 */
function packAttributesFor(
  directiveName: string,
  form: DirectiveForm,
  catalog: readonly InsertableComponent[],
): readonly PackComponentAttribute[] {
  const entry = findCatalogEntry(catalog, directiveName);
  if (entry?.source !== 'pack' || entry.attributes === undefined) return [];
  if (form === 'inline') return entry.attributes;
  return entry.attributes.filter(
    (attribute) => !LAYOUT_ATTRIBUTE_NAME_SET.has(attribute.name),
  );
}

/**
 * Expresses a pack's declared attribute as the same `AttributeSchema` a
 * standard contract carries, so `attributeNameItem` below stays the ONE
 * item builder for both sources rather than growing a near-duplicate for
 * pack attributes. `default` has no place in `AttributeSchema` and is not
 * invented into one here; it reaches the author through the attribute doc
 * lines in `./documentation.ts`.
 */
function schemaForPackAttribute(
  attribute: PackComponentAttribute,
): AttributeSchema {
  return {
    type: 'string',
    ...(attribute.required === true ? { required: true } : {}),
    ...(attribute.values !== undefined ? { enum: attribute.values } : {}),
    description: attribute.description ?? '',
  };
}

function attributeNameItem(
  name: string,
  schema: AttributeSchema,
): CompletionItem {
  const insertText = `${name}=""`;
  const insertCursorOffset = name.length + 2;
  const requiredPrefix = schema.required === true ? 'required. ' : '';
  // A pack may declare an attribute with no description at all, which a
  // standard contract never does. Trimming keeps that case from reading as
  // `required. ` with a dangling separator, and is a no-op for every
  // described attribute.
  const detail = `${requiredPrefix}${firstSentence(schema.description)}`.trim();

  return {
    label: name,
    kind: 'attribute',
    detail,
    documentation: { summary: schema.description, attributes: [], example: '' },
    insertText,
    insertCursorOffset,
  };
}

/**
 * The two reserved layout attributes, read from `@markii/stdlib` rather
 * than re-listed here: that package is the one source of the layout
 * vocabulary, and a third hand-copied literal is exactly what it exists to
 * prevent.
 */
const LAYOUT_ATTRIBUTE_NAMES = LAYOUT_ATTRIBUTE_KEYS;

const LAYOUT_ATTRIBUTE_NAME_SET: ReadonlySet<string> = new Set(
  LAYOUT_ATTRIBUTE_NAMES,
);

function attributeNameCompletionContext(
  ctx: AttributeNameParseResult,
  catalog: readonly InsertableComponent[],
): CompletionContext {
  const contract = getContract(ctx.directiveName);
  const items: CompletionItem[] = [];
  const offered = new Set<string>();

  if (contract !== undefined) {
    for (const [name, schema] of Object.entries(contract.attributes)) {
      if (ctx.presentNames.has(name.toLowerCase())) continue;
      items.push(attributeNameItem(name, schema));
      offered.add(name.toLowerCase());
    }
  } else {
    // No contract means this is not a standard component, so the only
    // attribute metadata that can exist for it is what its pack declared
    // (issue #27 slice 4). A pack that declared none simply contributes no
    // rows, and the layout attributes below still apply.
    for (const attribute of packAttributesFor(
      ctx.directiveName,
      ctx.form,
      catalog,
    )) {
      if (ctx.presentNames.has(attribute.name.toLowerCase())) continue;
      items.push(
        attributeNameItem(attribute.name, schemaForPackAttribute(attribute)),
      );
      offered.add(attribute.name.toLowerCase());
    }
  }

  if (ctx.form !== 'inline') {
    for (const name of LAYOUT_ATTRIBUTE_NAMES) {
      if (ctx.presentNames.has(name) || offered.has(name)) continue;
      items.push(attributeNameItem(name, LAYOUT_ATTRIBUTES[name]));
    }
  }

  return {
    kind: 'attribute-name',
    replaceStart: ctx.replaceStart,
    replaceEnd: ctx.replaceEnd,
    items,
  };
}

function resolveValueEnum(
  ctx: AttributeValueParseResult,
  catalog: readonly InsertableComponent[],
): readonly string[] | undefined {
  if (
    ctx.form !== 'inline' &&
    (ctx.attributeName === 'width' || ctx.attributeName === 'align')
  ) {
    return LAYOUT_ATTRIBUTES[ctx.attributeName].enum;
  }
  const contract = getContract(ctx.directiveName);
  if (contract === undefined) {
    // A pack component's declared `values`, read through the same filtered
    // accessor the attribute-name context uses, so a name offered from the
    // layout source can never take its values from a pack declaration.
    return packAttributesFor(ctx.directiveName, ctx.form, catalog).find(
      (attribute) => attribute.name === ctx.attributeName,
    )?.values;
  }
  // `Object.hasOwn`, not bare indexing: a directive attribute literally
  // named `constructor` or `__proto__` must miss this lookup rather than
  // resolve through the prototype chain to an inherited `Object.prototype`
  // member. Same defense `getContract` itself applies one level up.
  if (!Object.hasOwn(contract.attributes, ctx.attributeName)) return undefined;
  return contract.attributes[ctx.attributeName]?.enum;
}

function attributeValueItem(
  value: string,
  ctx: AttributeValueParseResult,
): CompletionItem {
  let insertText: string;
  if (ctx.quoteChar === undefined) {
    insertText = value;
  } else if (ctx.hasClosingQuote) {
    insertText = value;
  } else {
    insertText = `${value}${ctx.quoteChar}`;
  }

  return {
    label: value,
    kind: 'value',
    detail: '',
    insertText,
    insertCursorOffset: insertText.length,
  };
}

function attributeValueCompletionContext(
  ctx: AttributeValueParseResult,
  catalog: readonly InsertableComponent[],
): CompletionContext {
  const enumValues = resolveValueEnum(ctx, catalog);
  if (enumValues === undefined || enumValues.length === 0) {
    return EMPTY_CONTEXT_AT(ctx.replaceEnd);
  }

  return {
    kind: 'attribute-value',
    replaceStart: ctx.replaceStart,
    replaceEnd: ctx.replaceEnd,
    items: enumValues.map((value) => attributeValueItem(value, ctx)),
  };
}

/**
 * The one entry point a host calls: the current line's text, the zero-based
 * cursor column, and the insert catalog. Never throws; returns a `'none'`
 * context when nothing completes here.
 */
export function completionAt(
  line: string,
  column: number,
  catalog: readonly InsertableComponent[],
): CompletionContext {
  try {
    const safeLine = typeof line === 'string' ? line : '';
    const safeCatalog = Array.isArray(catalog) ? catalog : [];
    const clampedColumn = clampColumn(safeLine, column);
    const ctx = parseCompletionContext(safeLine, clampedColumn);

    switch (ctx.kind) {
      case 'attribute-value':
        return attributeValueCompletionContext(ctx, safeCatalog);
      case 'attribute-name':
        return attributeNameCompletionContext(ctx, safeCatalog);
      case 'directive-name':
        return directiveNameCompletionContext(ctx, safeCatalog, safeLine);
      default:
        return EMPTY_CONTEXT_AT(clampedColumn);
    }
  } catch {
    return EMPTY_CONTEXT_AT(clampColumn(line, column));
  }
}

/**
 * The directive under the cursor, for a hover popup. `undefined` when the
 * cursor is not on a known component's directive name.
 */
export function hoverAt(
  line: string,
  column: number,
  catalog: readonly InsertableComponent[],
): HoverInfo | undefined {
  try {
    const safeLine = typeof line === 'string' ? line : '';
    const safeCatalog = Array.isArray(catalog) ? catalog : [];
    const token = findDirectiveNameTokenAt(safeLine, column);
    if (token === undefined) return undefined;

    const entry = findCatalogEntry(safeCatalog, token.name);
    if (entry === undefined) return undefined;

    return {
      directiveName: entry.directiveName,
      documentation: componentDocumentation(entry),
      start: token.start,
      end: token.end,
    };
  } catch {
    return undefined;
  }
}
