/**
 * The registry contract for the HTML engine: the string-emitting twin of
 * `@markii/react`'s `registry.ts`. Everything here is framework-free by
 * construction (no React types), because a component is a plain function
 * from attributes and already-rendered children to an HTML string. The
 * alias, merge, and hostile-configuration rules are deliberately identical to
 * the React renderer's, so a note resolves the same way in both.
 */

import type { FailureKind, ValueStatus } from '@markii/runtime';
import type { LayoutAxis } from '@markii/stdlib';

/**
 * Attributes parsed off a directive, e.g. `{type=warning title="Careful"}`. A
 * bare attribute (present but valueless, e.g. `{collapsed}`) arrives as
 * `null`. A key that was never written is simply absent.
 */
export type DirectiveAttributes = Record<string, string | null | undefined>;

/**
 * A `data=`/`:value[...]` name resolved against the render's value store
 * (and, for an `@`-prefixed name, its vault) — the string engine's read-only
 * view of `./resolve.js`'s `StorePathResolution`. Never carries a `Proxy` or
 * any other live handle: `value` is whatever the store returned, but
 * `status`/`error`/`failureKind` are already validated primitives.
 */
export interface ValueResolution {
  value: unknown;
  status: ValueStatus;
  error?: string;
  failureKind?: FailureKind;
}

/**
 * The render context handed to every component. `esc` is the engine's single
 * HTML-escaping primitive (see `./escape`), so a component never hand-rolls
 * escaping.
 *
 * `resolve` looks up a `data=`-style name (dotted paths, `@`-prefixed vault
 * names) against the store/vault the current render was called with; it
 * degrades to `{ value: undefined, status: 'missing' }` when there is no
 * store/vault, or the name doesn't resolve — it never throws. `valueMarker`
 * is the empty/stale-state presentation for a resolved name, matching
 * `@markii/react`'s `ValueDirective` exactly (the missing-value `{name}`
 * span, the stale underline, the failure-kind tooltip); it is what powers
 * the `:value[...]` built-in and is exposed here so a data-bound component
 * can render the identical marker for a name it resolves itself.
 *
 * `data`/`dataStatus`/`dataError`/`dataFailureKind` mirror `@markii/react`'s
 * `MarkComponentProps` fields, just carried on `ctx` instead of a fourth
 * function parameter (the `HtmlComponent` signature is `(attributes,
 * childrenHtml, ctx)`, with no room for a fifth argument). They are present
 * ONLY when the directive actually had a `data=` attribute — `dataStatus`
 * is always one of the four `ValueStatus` values in that case, even when the
 * name didn't resolve (`'missing'`); all four are `undefined` together when
 * there was no `data=` attribute at all, exactly like the `'data' in
 * binding` distinction `@markii/react`'s `renderDirectiveContent` makes.
 */
export interface HtmlRenderContext {
  /** HTML-escapes a string for safe insertion into text or a quoted attribute value. */
  esc(value: string): string;
  /** Resolves a `data=`/`:value[...]` name against the current render's store/vault. Never throws. */
  resolve(name: string): ValueResolution;
  /** The quiet missing/stale/failure-tinted marker for `name`, matching `@markii/react`'s `ValueDirective` markup exactly. Never throws. */
  valueMarker(name: string): string;
  data?: unknown;
  dataStatus?: ValueStatus;
  dataError?: string;
  dataFailureKind?: FailureKind;
  /**
   * The layout class the directive's reserved `width`/`align` attributes
   * resolved to, handed to the component instead of being applied to a
   * wrapper `<div>` around it. Present ONLY for an entry registered with
   * `layout` (a scope component, such as the standard `:::center`), and only
   * for the axis that entry does not already own. Mirrors
   * `@markii/react`'s `layoutClassName` prop, carried on `ctx` for the same
   * reason the data-binding fields are: `HtmlComponent` takes three
   * arguments and has no room for a fourth.
   */
  layoutClassName?: string;
}

/**
 * One registry component: receives the directive's raw string attributes
 * (bare attributes as `null`), its inner markdown already rendered to an HTML
 * string, and the render context, and returns the HTML string to emit.
 * Attribute parsing, validation, and defaulting are the component's own job,
 * exactly as in the React contract.
 */
export type HtmlComponent = (
  attributes: DirectiveAttributes,
  childrenHtml: string,
  ctx: HtmlRenderContext,
) => string;

/**
 * One registry entry: the component plus whether it is meant to be used
 * inline (text directive) vs as a block (leaf/container directive). Only an
 * explicit `inline: false` drives the form/kind mismatch rule; `undefined`
 * says nothing about kind.
 */
export interface HtmlRegistryEntry {
  component: HtmlComponent;
  inline?: boolean;
  /**
   * Declares this component a LAYOUT SCOPE that already sets one of the two
   * layout axes by its own name, the way the standard `:::center` (align)
   * and `:::fit` (width) wrappers do. The reserved attribute for that axis
   * is dropped without effect; the other axis resolves and arrives as
   * `ctx.layoutClassName` instead of on a wrapper `<div>`, so the scope
   * emits one element carrying both classes. Either way a component never
   * receives `width` or `align` among its attributes (docs/spec.md §2).
   * Mirrors `@markii/react`'s `RegistryEntry.layout`.
   */
  layout?: LayoutAxis;
}

/** One alias: a second name for an existing component, optionally carrying preset attributes. */
export interface RegistryAlias {
  name: string;
  attributes?: DirectiveAttributes;
}

/** Alias name -> what it stands for. */
export type RegistryAliases = Record<string, RegistryAlias>;

/**
 * The symbol an alias table hangs off a registry under: a symbol rather than
 * a string key so it can never collide with a directive name, never show up
 * in `Object.keys`, and still ride across `Object.assign` (so `mergeHtml`
 * `Registries` carries it). Mirrors `@markii/react`'s `REGISTRY_ALIASES`.
 */
export const REGISTRY_ALIASES: unique symbol = Symbol(
  'markii.html.registry.aliases',
);

/** Directive name -> component registration, plus an optional alias table under `REGISTRY_ALIASES`. */
export interface HtmlRegistry {
  [name: string]: HtmlRegistryEntry;
  [REGISTRY_ALIASES]?: RegistryAliases;
}

/** Reads a registry's alias table, or `undefined` when it has none. Returned as-is; treat as read-only. */
export function registryAliases(
  registry: HtmlRegistry,
): RegistryAliases | undefined {
  return registry[REGISTRY_ALIASES];
}

/**
 * Combines alias tables left-to-right into one null-prototype map, later
 * tables winning per name. Returns `undefined` when no input carried aliases,
 * so an alias-free merge stays alias-free.
 */
function mergeAliasTables(
  tables: (RegistryAliases | undefined)[],
): RegistryAliases | undefined {
  const present = tables.filter(
    (table): table is RegistryAliases => table !== undefined,
  );
  if (present.length === 0) return undefined;

  const merged = Object.create(null) as RegistryAliases;
  for (const table of present) {
    for (const name of Object.keys(table)) merged[name] = table[name]!;
  }
  return merged;
}

/**
 * Creates a registry from a plain object of entries plus an optional alias
 * table. The returned map has a `null` prototype so a directive named
 * `constructor`, `toString`, `hasOwnProperty`, etc. cannot resolve to an
 * inherited member; only entries actually registered are ever found.
 */
export function createHtmlRegistry(
  entries: HtmlRegistry = {},
  aliases?: RegistryAliases,
): HtmlRegistry {
  const registry = Object.assign(Object.create(null) as HtmlRegistry, entries);
  const merged = mergeAliasTables([registryAliases(entries), aliases]);
  if (merged) registry[REGISTRY_ALIASES] = merged;
  return registry;
}

/**
 * Merges any number of registries, later ones taking precedence, into a
 * null-prototype map. Alias tables merge per name, not wholesale, so a later
 * registry that defines any alias does not silently drop earlier ones.
 */
export function mergeHtmlRegistries(
  ...registries: HtmlRegistry[]
): HtmlRegistry {
  const merged = Object.assign(
    Object.create(null) as HtmlRegistry,
    ...registries,
  ) as HtmlRegistry;
  const aliases = mergeAliasTables(registries.map(registryAliases));
  if (aliases) merged[REGISTRY_ALIASES] = aliases;
  else delete merged[REGISTRY_ALIASES];
  return merged;
}

/**
 * Reads `entry.component`, or `undefined` if `entry` is nullish or the read
 * itself throws. A hand-built registry can define `component` as a throwing
 * getter (or a trapping `Proxy`); a throwing read degrades to "no component
 * here", identical to a genuinely absent one, never an exception escaping the
 * renderer (docs/spec.md requirement 4).
 */
export function readRegistryComponent(
  entry: HtmlRegistryEntry | undefined,
): HtmlComponent | undefined {
  if (!entry) return undefined;
  try {
    return entry.component ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The layout axis the component registered under `name` owns, or
 * `undefined` when there is no such entry, it has no usable component, or it
 * is not a layout scope. Reads `entry.layout` behind the same try/catch
 * `readRegistryComponent` uses, so a hostile throwing getter degrades to
 * "not a layout scope"; a value that is not one of the two axis names is
 * ignored the same way an invalid `width=` is.
 *
 * A broken entry is deliberately NOT a layout scope: it renders the
 * unknown-directive fallback, which has no root element to hand a class to,
 * so the directive keeps the ordinary wrapper `<div>` and its `width`/
 * `align` still show. Mirrors `@markii/react`'s `registryLayoutAxis`.
 */
export function registryLayoutAxis(
  registry: HtmlRegistry,
  name: string,
): LayoutAxis | undefined {
  const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (readRegistryComponent(entry) == null) return undefined;
  try {
    const axis = entry?.layout;
    return axis === 'width' || axis === 'align' ? axis : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `registry` has a real, usable component under `name` (own property, non-nullish, non-throwing). */
function hasComponent(registry: HtmlRegistry, name: string): boolean {
  return (
    Object.hasOwn(registry, name) &&
    readRegistryComponent(registry[name]) != null
  );
}

/** Merges an alias's preset attributes under the author's own, author winning on collision ("closest to the text wins"). */
function mergeAliasAttributes(
  preset: DirectiveAttributes | undefined,
  author: DirectiveAttributes,
): DirectiveAttributes {
  if (!preset) return author;
  const result: DirectiveAttributes = {};
  for (const [key, value] of Object.entries(preset)) result[key] = value;
  for (const [key, value] of Object.entries(author)) result[key] = value;
  return result;
}

/** A directive name and attributes after alias resolution. */
export interface ResolvedDirective {
  name: string;
  attributes: DirectiveAttributes;
}

/**
 * Resolves one directive name through the registry's alias table. Four rules,
 * in order: a real component wins over any alias; an unaliased name passes
 * through; an alias is followed exactly one hop (a chain lands on the
 * unknown-directive fallback rather than chaining); author attributes win over
 * the alias's presets. Never throws; a malformed alias degrades to the
 * ordinary unknown-directive path. Identical to `@markii/react`'s rule.
 */
export function resolveDirectiveAlias(
  registry: HtmlRegistry,
  name: string,
  attributes: DirectiveAttributes,
): ResolvedDirective {
  if (hasComponent(registry, name)) return { name, attributes };

  const aliases = registryAliases(registry);
  if (!aliases || !Object.hasOwn(aliases, name)) return { name, attributes };

  const alias = aliases[name];
  if (typeof alias?.name !== 'string' || alias.name === '') {
    return { name, attributes };
  }

  return {
    name: alias.name,
    attributes: mergeAliasAttributes(alias.attributes, attributes),
  };
}
