import type { FC, ReactNode } from 'react';
import type { FailureKind, ValueStatus } from './value-types.js';
import type { LayoutAxis, OnDiagnostic } from '@markii/stdlib';
import type { ColorLevel } from './ansi.js';
import type { AnsiTheme, Tier1Token } from './theme.js';
import type { ResolvedLayoutAttributes } from './layout.js';
import type { ResolveImageSrc } from './image-resolve.js';
import type { ResolveHref } from './href-resolve.js';

/**
 * The registry contract for the terminal engine, batch-10 (the Ink
 * rewrite): a component is a React function component receiving
 * `{ attributes, children, ctx }`, where `children` is ALREADY a built Ink
 * element tree (a `ReactNode`) rather than the lazy string-producing
 * `AnsiChildren` handle the pre-Ink engine used. Building children eagerly
 * is the batch-10 brief's own instruction (`AGENTS.md`'s architecture
 * section is silent on this; the brief is explicit: "Delete... the lazy-
 * children machinery"): Ink/Yoga lays a tree out AFTER it is built, exactly
 * like a browser reflows HTML, so a component no longer needs to ask for a
 * narrower re-render of its own body the way the old string engine did —
 * the one standard component that still needs a per-cell WIDTH NUMBER before
 * it draws (`row`, whose cells may hold a self-drawing box like `card`) gets
 * that from `render.tsx`'s own walk, which still threads `width` top-down
 * exactly as before; see `render.tsx`'s `renderRow` for why that one case is
 * handled at the walk level rather than through a registry-facing API.
 */

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
 * The render context handed to every component. Mirrors the pre-Ink
 * engine's `AnsiRenderContext` for every field EXCEPT the string-layout
 * helpers (`wrap`/`pad`/`columns`/`frame`/`rule`), which are dropped:
 * ordinary prose now wraps through Ink's own layout, and the handful of
 * self-drawing standard components (`card`, `callout`, `divider`, `chart`,
 * `table`) that still need exact box-drawing glyphs use `./text-grid.js`'s
 * private helpers directly rather than through the context.
 */
export interface AnsiRenderContext {
  /** The columns available to this directive's own output. A self-drawing component sizes its own frame to this width (or to `layout`'s resolved preset of it). */
  width: number;
  /**
   * The prefix an enclosing block (a blockquote, a nested list) has already
   * applied to every line above this directive, informational only: a
   * component draws its own content at `width` and the walk applies the
   * enclosing indent as an Ink `Box` wrapper, not as a string prefix.
   */
  indent: string;
  /** The resolved color depth for this render. */
  color: ColorLevel;
  /** The resolved theme for this render. */
  theme: AnsiTheme;
  /**
   * Whether this render is in INTERACTIVE mode (a live viewer), as opposed
   * to the default render-once mode. NAME COLLISION, documented at both
   * declarations: this is UNRELATED to Ink's own `render()` option also
   * spelled `interactive` (`ink-string.ts`'s doc comment) — that one
   * controls which escape sequences Ink emits around a frame; this one
   * controls which CONTENT a component renders (`tabs` shows only the
   * active panel, `details` starts closed unless `open` is present) and
   * whether it registers a keyboard handler at all.
   */
  interactive: boolean;
  /**
   * A stable, document-order identity for a FOCUSABLE component (currently
   * `tabs` and `details`) when `interactive` is true; `undefined` when not
   * interactive, or for any other component. Assigned once by `render.tsx`
   * as it walks the tree (see `render.tsx`'s `WalkContext.nextFocusId`), so
   * a component never has to compute its own position in document order.
   */
  focusId?: number;
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
  /**
   * The sanitizer a component MUST run any author-supplied string through
   * before printing it: strips every control character an untrusted note
   * could use to move the cursor or smuggle an escape sequence
   * (`./sanitize.js`'s `stripControlCharacters`).
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
 * One registry component: a React function component. `attributes` are the
 * directive's raw string attributes (bare attributes as `null`); `children`
 * is the directive's already-rendered inner markdown, an Ink element tree;
 * `ctx` is `AnsiRenderContext` above. Attribute parsing, validation, and
 * defaulting are the component's own job, exactly as in the other two
 * engines' contracts. A component MAY use React hooks (`useState`,
 * `useInput`, ...) since `render.tsx` always invokes it as a JSX element,
 * never as a plain function call — `tabs` and `details` need this for
 * interactive mode.
 */
export interface AnsiComponentProps {
  attributes: DirectiveAttributes;
  children: ReactNode;
  ctx: AnsiRenderContext;
}
export type AnsiComponent = FC<AnsiComponentProps>;

/** One registry entry: the component plus whether it is meant to be used inline vs as a block, and whether it is a layout scope. Mirrors `@markii/html`'s `HtmlRegistryEntry`. */
export interface AnsiRegistryEntry {
  component: AnsiComponent;
  inline?: boolean;
  layout?: LayoutAxis;
  /**
   * Marks a component that draws its OWN fixed-width block (box-drawing
   * glyphs, a rule, a sparkline) rather than plain wrapped prose — `card`,
   * `callout`, `divider`, `table`, `chart` in the standard set. A generic
   * post-render narrow/align pass would corrupt a pre-drawn frame's
   * box-drawing characters, so a `selfLayout` component instead receives the
   * resolved `width`/`align` presets as `ctx.layout` and is trusted to size
   * its own frame correctly; `render.tsx` skips its usual post-render
   * `applyLayout` wrapping for it. Kept from the pre-Ink engine: Ink's own
   * layout does not solve this, because the content in question is a
   * pre-built STRING (see `text-grid.ts`'s module doc comment), not
   * Ink primitives Yoga can reflow.
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

/**
 * Reads a component's `children` prop back as plain text. `render.tsx`
 * always hands most standard components (every one except `row`, `tabs`,
 * `details`) an already-flattened STRING as `children` — see `render.tsx`'s
 * top comment on why those three are the only ones that get a real Ink
 * element tree instead. `children` is still typed `ReactNode` on
 * `AnsiComponentProps` (the honest public contract: "an Ink element tree",
 * per the batch-10 brief, and a string IS a valid `ReactNode`), so a
 * component that needs its body AS TEXT (to measure it, frame it, indent
 * it, or check whether it is empty) reads it through this helper rather
 * than assuming the type; a non-string `children` degrades to `''` rather
 * than throwing, matching this package's never-throw posture everywhere
 * else.
 */
export function childrenText(children: ReactNode): string {
  return typeof children === 'string' ? children : '';
}
