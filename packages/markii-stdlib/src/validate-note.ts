/**
 * The one engine-independent check of a parsed note: what is wrong with its
 * directives no matter which renderer draws them. A host that places
 * findings in the note's source (a language server) calls `validateNote`
 * with the tree `@markii/core`'s `parse` returns and a catalog of the
 * components the note may use. Nothing here renders, runs a script, or
 * loads pack code, and the module imports no parser: the tree is input.
 *
 * Three kinds of finding need no engine and are reported here:
 * `'unknown-directive'` (a name no catalog entry matches),
 * `'form-mismatch'` (a block component written inline), and
 * `'invalid-attribute-value'` (a value outside a declared enum). The
 * renderers report the last two themselves when they draw a note, through
 * the same predicates (`invalidEnumAttribute` below); engine-specific
 * findings (`'no-engine-view'`, `'unsafe-image-src'`,
 * `'code-renderer-failed'`) stay in the engines.
 *
 * The messages are diagnostics-surface text. They match the wording each
 * engine's failure-presentation module uses for the same finding, and
 * each engine's drift test pins that.
 */
import { LAYOUT_ATTRIBUTE_KEYS } from './layout.js';
import {
  getContract,
  STANDARD_COMPONENTS,
  type ComponentKind,
} from './contracts.js';
import type { DiagnosticEvent, DiagnosticPosition } from './diagnostics.js';

/** The directive name that no catalog needs: `:value[...]` is built into every renderer. */
const VALUE_DIRECTIVE_NAME = 'value';

const DIRECTIVE_NODE_TYPES: ReadonlySet<string> = new Set([
  'textDirective',
  'leafDirective',
  'containerDirective',
]);

/**
 * The part of an mdast node `validateNote` reads. Structural on purpose, so
 * this package does not import `@markii/core` or `mdast`: the tree
 * `parse` returns is assignable to it.
 */
export interface NoteTreeNode {
  readonly type: string;
  readonly name?: string;
  readonly attributes?: Readonly<
    Record<string, string | null | undefined>
  > | null;
  readonly children?: readonly NoteTreeNode[];
  readonly position?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}

/** One attribute a catalog entry declares; the same shape as `EditorComponentAttribute`. */
export interface NoteCatalogAttribute {
  readonly name: string;
  /** The closed set of allowed values, when the attribute is an enum. */
  readonly values?: readonly string[];
}

/**
 * One component a note may use. `InsertableComponent` (the editor
 * catalog's entry, which `@markii/host` builds from each pack's
 * `pack.json`) is assignable to it, so a host reuses that catalog.
 */
export interface NoteCatalogEntry {
  /** The directive name an author writes, e.g. `callout` or `cat_card`. */
  readonly directiveName: string;
  readonly kind: ComponentKind;
  /** False when `kind` is only a default (a pack component that declared none); no form check is made then. */
  readonly kindDeclared: boolean;
  readonly attributes?: readonly NoteCatalogAttribute[];
}

/** The standard set as catalog entries, with each enum attribute's allowed values. */
export function standardNoteCatalog(): readonly NoteCatalogEntry[] {
  return Object.values(STANDARD_COMPONENTS).map((contract) => ({
    directiveName: contract.name,
    kind: contract.kind,
    kindDeclared: true,
    attributes: Object.entries(contract.attributes).map(([name, schema]) => ({
      name,
      ...(schema.enum !== undefined ? { values: schema.enum } : {}),
    })),
  }));
}

/**
 * The standard set followed by `extra` entries (a pack's components). An
 * extra entry whose name is already taken is skipped, so the first claim on
 * a name wins, as it does in the editor catalog.
 */
export function buildNoteCatalog(
  extra: readonly NoteCatalogEntry[],
): readonly NoteCatalogEntry[] {
  const catalog = [...standardNoteCatalog()];
  const taken = new Set(catalog.map((entry) => entry.directiveName));
  for (const entry of extra) {
    if (taken.has(entry.directiveName)) continue;
    taken.add(entry.directiveName);
    catalog.push(entry);
  }
  return catalog;
}

type DirectiveAttributes = Readonly<Record<string, string | null | undefined>>;

/**
 * The first attribute in `declared` that is written with a value outside its
 * closed set. An absent, bare, or empty value is never a violation. Shared
 * by `invalidEnumAttribute` and `validateNote`, so the predicate has one
 * home.
 */
function firstInvalidEnum(
  declared: Iterable<readonly [string, readonly string[] | undefined]>,
  attributes: DirectiveAttributes,
): { attribute: string; value: string } | undefined {
  for (const [attribute, values] of declared) {
    if (!values) continue;
    if (!Object.hasOwn(attributes, attribute)) continue;
    const value = attributes[attribute];
    if (value === undefined || value === null || value === '') continue;
    if (!values.includes(value)) return { attribute, value };
  }
  return undefined;
}

/**
 * Whether one of the standard component `name`'s contract attributes with a
 * closed enum is present in `attributes` with a value outside it, such as
 * `card{text="Hey"}`. Returns the first offending pair, or `undefined` when
 * `name` is not a standard component or nothing is out of range. The
 * renderers call this on the attributes a component received, after the
 * reserved layout keys were removed.
 */
export function invalidEnumAttribute(
  name: string,
  attributes: DirectiveAttributes,
): { attribute: string; value: string } | undefined {
  const contract = getContract(name);
  if (!contract) return undefined;
  return firstInvalidEnum(
    Object.entries(contract.attributes).map(
      ([attribute, schema]) => [attribute, schema.enum] as const,
    ),
    attributes,
  );
}

/** The diagnostic text for a directive that names no known component. */
export function unknownDirectiveMessage(directive: string): string {
  return `${directive}: unknown component, shown as a placeholder`;
}

/** The diagnostic text for a block component written as an inline directive. */
export function formMismatchMessage(directive: string): string {
  return `${directive}: block component was written inline and was not rendered`;
}

/** The diagnostic text for an attribute value outside its closed set. */
export function invalidAttributeValueMessage(
  directive: string,
  attribute: string,
  value: string,
): string {
  return `${directive}: "${value}" is not a valid ${attribute} value (ignored)`;
}

function positionOf(node: NoteTreeNode): DiagnosticPosition | undefined {
  const range = node.position;
  if (range === undefined) return undefined;
  return {
    startLine: range.start.line,
    startColumn: range.start.column,
    endLine: range.end.line,
    endColumn: range.end.column,
  };
}

function stripLayoutKeys(attributes: DirectiveAttributes): DirectiveAttributes {
  const rest: Record<string, string | null | undefined> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if ((LAYOUT_ATTRIBUTE_KEYS as readonly string[]).includes(key)) continue;
    rest[key] = value;
  }
  return rest;
}

/**
 * The findings in a note that need no renderer, in document order, each
 * carrying the source range of its directive. Never throws: a node of an
 * unexpected shape is skipped.
 *
 * A directive resolves against `catalog` by exact name. `:value[...]` is
 * built into every renderer and is never reported. A form mismatch is
 * reported only for an inline directive naming a catalog entry whose kind
 * is declared and is not `inline`; the reverse is not a finding, since a
 * renderer draws it. Attribute enums are checked on the attributes left
 * after the reserved `width` and `align` keys are removed, as a renderer
 * sees them.
 */
export function validateNote(
  tree: NoteTreeNode,
  catalog: readonly NoteCatalogEntry[],
): DiagnosticEvent[] {
  const byName = new Map<string, NoteCatalogEntry>();
  for (const entry of catalog) {
    if (!byName.has(entry.directiveName))
      byName.set(entry.directiveName, entry);
  }
  const events: DiagnosticEvent[] = [];

  const visit = (node: NoteTreeNode): void => {
    if (node === null || typeof node !== 'object') return;
    if (
      typeof node.type === 'string' &&
      DIRECTIVE_NODE_TYPES.has(node.type) &&
      node.name !== VALUE_DIRECTIVE_NAME
    ) {
      check(node);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };

  const check = (node: NoteTreeNode): void => {
    const name =
      typeof node.name === 'string' && node.name !== '' ? node.name : '';
    const position = positionOf(node);
    const at = position === undefined ? {} : { position };
    const entry = name === '' ? undefined : byName.get(name);
    if (entry === undefined) {
      const shown = name || '(unnamed)';
      events.push({
        kind: 'unknown-directive',
        directive: shown,
        message: unknownDirectiveMessage(shown),
        ...at,
      });
      return;
    }
    if (
      node.type === 'textDirective' &&
      entry.kindDeclared &&
      entry.kind !== 'inline'
    ) {
      events.push({
        kind: 'form-mismatch',
        directive: name,
        message: formMismatchMessage(name),
        ...at,
      });
      return;
    }
    const attributes = stripLayoutKeys(node.attributes ?? {});
    const invalid = firstInvalidEnum(
      (entry.attributes ?? []).map((a) => [a.name, a.values] as const),
      attributes,
    );
    if (invalid !== undefined) {
      events.push({
        kind: 'invalid-attribute-value',
        directive: name,
        attribute: invalid.attribute,
        message: invalidAttributeValueMessage(
          name,
          invalid.attribute,
          invalid.value,
        ),
        ...at,
      });
    }
  };

  visit(tree);
  return events;
}
