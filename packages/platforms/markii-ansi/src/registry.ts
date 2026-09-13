/**
 * The registry contract for the terminal engine: the string-emitting twin of
 * `@markii/html`'s `registry.ts`, itself the string-emitting twin of
 * `@markii/react`'s `registry.ts`. A component here is a plain function from
 * attributes and already-rendered children TEXT to an output string — no
 * hast, no React, no HTML. The alias, merge, and hostile-configuration rules
 * are kept identical to both existing renderers, so a note resolves the same
 * way in all three.
 */

import type { FailureKind, ValueStatus } from './value-types.js';
import type { LayoutAxis, OnDiagnostic } from '@markii/stdlib';
import type { ColorLevel } from './ansi.js';
import type { AnsiTheme, Tier1Token } from './theme.js';
import type { ResolvedLayoutAttributes } from './layout.js';
import type { ResolveImageSrc } from './image-resolve.js';
import type { ResolveHref } from './href-resolve.js';

/**
 * Attributes parsed off a directive, e.g. `{type=warning title="Careful"}`. A
 * bare attribute (present but valueless, e.g. `{collapsed}`) arrives as
 * `null`. A key that was never written is simply absent.
 */
export type DirectiveAttributes = Record<string, string | null | undefined>;

/**
 * A `data=`/`:value[...]` name resolved against the render's value store
 * (and, for an `@`-prefixed name, its vault) — this engine's read-only view
 * of `./resolve.js`'s `StorePathResolution`.
 */
export interface ValueResolution {
  value: unknown;
  status: ValueStatus;
  error?: string;
  failureKind?: FailureKind;
}

/**
 * The render context handed to every component. Mirrors
 * `@markii/html`'s `HtmlRenderContext` field for field, with the HTML-only
 * `esc` swapped for `text` (this engine's control-character sanitizer, see
 * `./sanitize.js`'s `stripControlCharacters`) and a set of terminal-only
 * fields added: `width`/`indent` (the layout budget this directive's own
 * output has to work with), `color`/`theme` (what this render resolved),
 * and the box/style helpers pre-bound to both.
 */
export interface AnsiRenderContext {
  /** The columns available to this directive's own output. A component wraps its own text to this width. */
  width: number;
  /**
   * The prefix an enclosing block (a blockquote, a nested list) has already
   * applied to every line above this directive. Informational only: a
   * component emits its own block UNINDENTED, and the walk applies the
   * prefix afterward, exactly as `width` is already the post-indent budget.
   */
  indent: string;
  /** The resolved color depth for this render. */
  color: ColorLevel;
  /** The resolved theme for this render. */
  theme: AnsiTheme;
  /** Applies `theme`'s color for `token` at this render's `color` level. Unchanged at `'none'` or for a `null` theme entry. */
  style(text: string, token: Tier1Token): string;
  /** SGR bold, pre-bound to this render's color level. */
  bold(text: string): string;
  /** SGR dim/faint, pre-bound to this render's color level. */
  dim(text: string): string;
  /** SGR italic, pre-bound to this render's color level. */
  italic(text: string): string;
  /** SGR underline, pre-bound to this render's color level. */
  underline(text: string): string;
  /** SGR inverse/reverse video, pre-bound to this render's color level. */
  inverse(text: string): string;
  /** Greedy word wrap, pre-bound to nothing (width is explicit here since a component may wrap narrower than its own `ctx.width`, e.g. inside its own frame). */
  wrap(text: string, width: number): string[];
  /** Pads `text` to `width` columns, aligned `left`/`center`/`right`. */
  pad(text: string, width: number, align: 'left' | 'center' | 'right'): string;
  /** Places blocks side by side; see `./box.js`'s `columns`. */
  columns(
    blocks: readonly string[],
    widths: readonly number[],
    gutter: number,
  ): string;
  /** Draws a box around `block`; see `./box.js`'s `frame`. */
  frame(
    block: string,
    options: { style: 'solid' | 'dashed'; title?: string; width: number },
  ): string;
  /** A full-width horizontal rule; see `./box.js`'s `rule`. */
  rule(width: number, char?: string): string;
  /**
   * The sanitizer a component MUST run any author-supplied string through
   * before printing it (this engine's counterpart to the HTML context's
   * `esc`): strips every control character an untrusted note could use to
   * move the cursor or smuggle an escape sequence (`./sanitize.js`'s
   * `stripControlCharacters`).
   */
  text(value: string): string;
  /** Resolves a `data=`/`:value[...]` name against the current render's store/vault. Never throws. */
  resolve(name: string): ValueResolution;
  /** The quiet missing/stale/failure-tinted marker for `name`. Never throws. */
  valueMarker(name: string, format?: string, decimals?: string): string;
  data?: unknown;
  dataStatus?: ValueStatus;
  dataError?: string;
  dataFailureKind?: FailureKind;
  /**
   * The resolved width/align presets for the axis a layout-scope entry does
   * not already own — this engine's counterpart to `@markii/html`'s
   * `layoutClassName`, carried as data instead of a class name since there
   * is no stylesheet here.
   */
  layout?: ResolvedLayoutAttributes['resolved'];
  resolveImageSrc?: ResolveImageSrc;
  resolveHref?: ResolveHref;
  onDiagnostic?: OnDiagnostic;
}

/**
 * One registry component: receives the directive's raw string attributes
 * (bare attributes as `null`), its inner markdown already rendered to plain
 * (possibly ANSI-carrying) text, and the render context, and returns the
 * text to emit. Attribute parsing, validation, and defaulting are the
 * component's own job, exactly as in the other two engines' contracts.
 */
export type AnsiComponent = (
  attributes: DirectiveAttributes,
  childrenText: string,
  ctx: AnsiRenderContext,
) => string;

/** One registry entry: the component plus whether it is meant to be used inline vs as a block, and whether it is a layout scope. Mirrors `@markii/html`'s `HtmlRegistryEntry`. */
export interface AnsiRegistryEntry {
  component: AnsiComponent;
  inline?: boolean;
  layout?: LayoutAxis;
  /**
   * Marks a component that draws its OWN box (a frame, a table grid) rather
   * than plain wrapped text — `card`, `callout`, `table`, `chart` in the
   * standard set. `applyLayout`'s generic re-wrap/pad would corrupt a
   * pre-drawn frame's box-drawing characters if `render.ts` narrowed it
   * AFTER the component already drew it at the full width. A `selfLayout`
   * component instead receives the resolved `width`/`align` presets as
   * `ctx.layout` (the same field a layout-WRAPPER scope receives) and is
   * trusted to size its own frame correctly; `render.ts` then skips its
   * usual post-render `applyLayout` call for it, exactly as it already does
   * for a layout-wrapper scope. Unlike `layout: LayoutAxis`, this is not
   * "this directive's name sets an axis" — it is "this directive draws pixels
   * that a generic wrap/pad would break."
   */
  selfLayout?: boolean;
}

/** One alias: a second name for an existing component, optionally carrying preset attributes. */
export interface RegistryAlias {
  name: string;
  attributes?: DirectiveAttributes;
}

/** Alias name -> what it stands for. */
export type RegistryAliases = Record<string, RegistryAlias>;

/** The symbol an alias table hangs off a registry under. Mirrors `@markii/html`'s `REGISTRY_ALIASES`. */
export const REGISTRY_ALIASES: unique symbol = Symbol(
  'markii.ansi.registry.aliases',
);

/** Directive name -> component registration, plus an optional alias table under `REGISTRY_ALIASES`. */
export interface AnsiRegistry {
  [name: string]: AnsiRegistryEntry;
  [REGISTRY_ALIASES]?: RegistryAliases;
}

/** Reads a registry's alias table, or `undefined` if it has none. Returned as-is; treat as read-only. */
export function registryAliases(
  registry: AnsiRegistry,
): RegistryAliases | undefined {
  return registry[REGISTRY_ALIASES];
}

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
 * inherited member.
 */
export function createAnsiRegistry(
  entries: AnsiRegistry = {},
  aliases?: RegistryAliases,
): AnsiRegistry {
  const registry = Object.assign(Object.create(null) as AnsiRegistry, entries);
  const merged = mergeAliasTables([registryAliases(entries), aliases]);
  if (merged) registry[REGISTRY_ALIASES] = merged;
  return registry;
}

/** Merges any number of registries, later ones taking precedence, into a null-prototype map. Alias tables merge per name. */
export function mergeAnsiRegistries(
  ...registries: AnsiRegistry[]
): AnsiRegistry {
  const merged = Object.assign(
    Object.create(null) as AnsiRegistry,
    ...registries,
  ) as AnsiRegistry;
  const aliases = mergeAliasTables(registries.map(registryAliases));
  if (aliases) merged[REGISTRY_ALIASES] = aliases;
  else delete merged[REGISTRY_ALIASES];
  return merged;
}

/** Reads `entry.component`, or `undefined` if `entry` is nullish or the read itself throws. */
export function readRegistryComponent(
  entry: AnsiRegistryEntry | undefined,
): AnsiComponent | undefined {
  if (!entry) return undefined;
  try {
    return entry.component ?? undefined;
  } catch {
    return undefined;
  }
}

/** The layout axis the component registered under `name` owns, or `undefined`. Mirrors `@markii/html`'s `registryLayoutAxis`. */
export function registryLayoutAxis(
  registry: AnsiRegistry,
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

/** Whether the component registered under `name` is marked `selfLayout` (see `AnsiRegistryEntry`'s doc comment). Fails permissive (`false`) on a throwing `.selfLayout` getter, matching `registryLayoutAxis`'s defensiveness. */
export function registrySelfLayout(
  registry: AnsiRegistry,
  name: string,
): boolean {
  const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (readRegistryComponent(entry) == null) return false;
  try {
    return entry?.selfLayout === true;
  } catch {
    return false;
  }
}

function hasComponent(registry: AnsiRegistry, name: string): boolean {
  return (
    Object.hasOwn(registry, name) &&
    readRegistryComponent(registry[name]) != null
  );
}

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
 * Resolves one directive name through the registry's alias table. Same four
 * rules as `@markii/html`'s `resolveDirectiveAlias`: a real component wins
 * over any alias; an unaliased name passes through; an alias is followed
 * exactly one hop; author attributes win over the alias's presets. Never
 * throws.
 */
export function resolveDirectiveAlias(
  registry: AnsiRegistry,
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
