/**
 * "Insert Component" (GitHub issue #17, slice 1): the standard-set half of
 * the insert catalog — every `@markii/stdlib` standard component, split
 * into its ordinary and layout-wrapper groups. Host-neutral and pure: no
 * `vscode`, no `obsidian`, no filesystem access. This package has zero
 * dependencies, so a pack's own contribution to the catalog (which needs
 * `@markii/pack`'s manifest types) is composed one layer up, by a host
 * (`@markii/host`'s `insert/component-catalog.ts`), which calls
 * `standardComponentCatalog` below and appends its own pack entries after
 * it.
 */
import type { ComponentKind } from '../../contracts.js';
import { STANDARD_COMPONENTS } from '../../contracts.js';
import { firstSentence } from './first-sentence.js';

/**
 * The seven layout-wrapper container directive names (docs/format.md):
 * alignment (`center`, `left`, `right`) and width presets (`fit`, `narrow`,
 * `wide`, `full`). Exported so a picker UI can render this group under its
 * own heading without hand-copying the name list, and so the colocated test
 * below can assert it stays in sync with `STANDARD_COMPONENTS`.
 */
export const LAYOUT_WRAPPER_NAMES: readonly string[] = [
  'center',
  'left',
  'right',
  'wide',
  'narrow',
  'full',
  'fit',
];

/**
 * The declared shape of one attribute a discovered component contributes,
 * structurally identical to `@markii/pack`'s `PackComponentAttribute` so
 * that a real `PackComponentAttribute` value remains assignable here
 * without this package depending on `@markii/pack` (this package has zero
 * dependencies by design; only a host composing a pack-aware catalog needs
 * the real pack types).
 */
export interface EditorComponentAttribute {
  /** The name an author writes inside `{...}`, e.g. `from`. */
  readonly name: string;
  /** Human-readable semantics, shown in a completion row and in hover documentation. */
  readonly description?: string;
  /** `true` when the component is incomplete without this attribute. A required attribute is pre-filled by the insert skeleton. */
  readonly required?: boolean;
  /** The closed set of allowed values, when the attribute is an enum. */
  readonly values?: readonly string[];
  /** The value used when the attribute is absent. */
  readonly default?: string;
}

/** One component a picker can offer to insert. */
export interface InsertableComponent {
  /** The directive name the author types, e.g. `callout`, or `cat_card` for a pack component. */
  readonly directiveName: string;
  readonly kind: ComponentKind;
  readonly source: 'standard' | 'pack';
  /**
   * Which section of a picker this entry belongs in: the ordinary standard
   * set, the layout-wrapper set (also `source: 'standard'`, since a layout
   * wrapper IS a standard component — `group` is the finer split a picker
   * UI wants), or a pack's own contribution.
   */
  readonly group: 'standard' | 'layout' | 'pack';
  /** Set only when `source === 'pack'`: the owning pack's namespace. */
  readonly packName?: string;
  /**
   * A short, one-line detail for a picker row, when one is available. RAW
   * material only: a standard component's contract first sentence, or a
   * pack component's manifest-declared `description` — never a composed
   * filler string like `From pack "x".`. A host that wants a fallback line
   * for a pack component with no declared description writes that string
   * itself, in its own wording module (AGENTS.md: hosts own their
   * user-facing strings).
   */
  readonly description?: string;
  /**
   * Required attribute names, in declaration order: a standard component's
   * contract order, or a pack component's own `attributes` order for the
   * entries it marked `required`. Empty when nothing is required, which is
   * still the case for every pack that declares no attributes at all.
   */
  readonly requiredAttributes: readonly string[];
  /**
   * A pack component's declared attribute metadata (issue #27 slice 4),
   * in the order the manifest declared it. Absent for a standard
   * component, whose attributes come from its `@markii/stdlib` contract
   * instead, and absent for a pack component that declared none.
   */
  readonly attributes?: readonly EditorComponentAttribute[];
  /**
   * True when `kind` came from the component's own declaration (every
   * standard component, and a pack component whose manifest entry
   * declares `kind`); false when `kind` is the pack-aware catalog's
   * `'container'` default for a pack component that declared none.
   */
  readonly kindDeclared: boolean;
}

/** Required attribute names off a contract's `attributes` map, in the map's own key order. */
function requiredAttributeNames(
  attributes: Record<string, { required?: boolean }>,
): string[] {
  return Object.keys(attributes).filter(
    (name) => attributes[name]?.required === true,
  );
}

const LAYOUT_WRAPPER_NAME_SET: ReadonlySet<string> = new Set(
  LAYOUT_WRAPPER_NAMES,
);

/**
 * Every standard component (including the layout wrappers), in
 * `STANDARD_COMPONENTS`'s own declaration order.
 */
function standardCatalogEntries(): InsertableComponent[] {
  return Object.entries(STANDARD_COMPONENTS).map(([name, contract]) => ({
    directiveName: name,
    kind: contract.kind,
    source: 'standard',
    group: LAYOUT_WRAPPER_NAME_SET.has(name) ? 'layout' : 'standard',
    description: firstSentence(contract.description),
    requiredAttributes: requiredAttributeNames(contract.attributes),
    kindDeclared: true,
  }));
}

/**
 * The standard-set half of the insert catalog: every non-layout standard
 * component first (declaration order), then the seven layout wrappers
 * (declaration order). A host composing a pack-aware catalog appends its
 * own pack entries after this, using the returned list's directive names
 * as the "already taken" set a pack component must not collide with.
 */
export function standardComponentCatalog(): readonly InsertableComponent[] {
  const standardAll = standardCatalogEntries();
  const standard = standardAll.filter((entry) => entry.group === 'standard');
  const layout = standardAll.filter((entry) => entry.group === 'layout');
  return [...standard, ...layout];
}
