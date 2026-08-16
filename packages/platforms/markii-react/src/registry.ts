import type { ComponentType, ReactNode } from 'react';
import type { ValueStatus } from '@markii/runtime';

/**
 * Attributes parsed off a directive, e.g. `{type=warning title="Careful"}`.
 * A bare attribute (present but valueless, e.g. `{collapsed}`) arrives as
 * `null`. A key that was never written is simply absent from the object.
 *
 * One key is special: `data` (DESIGN.md §8 — "`{data=stars}` feeds it to a
 * component"). The renderer intercepts `data` before a component ever sees
 * `attributes` — it is resolved against the value store and delivered as
 * the separate `data`/`dataStatus` props below, never left behind as a raw
 * string in `attributes`. See `render.tsx`'s `resolveDataAttribute`.
 */
export type DirectiveAttributes = Record<string, string | null | undefined>;

/**
 * Props every registry component receives. Attributes arrive as raw
 * strings (or null for bare attributes) — components are responsible for
 * parsing, validating, and defaulting their own attributes; `children` is
 * the directive's inner markdown, already rendered to React elements.
 *
 * `data`/`dataStatus` are populated only when the directive had a `data=`
 * attribute (§8): `data` is the resolved JS value from the value store
 * (`undefined` if the store has no such entry, or none was provided),
 * `dataStatus` mirrors its freshness (`@markii/runtime`'s `ValueStatus`).
 * Both are simply absent — not merely falsy — when the directive had no
 * `data=` attribute at all, so a component can tell "no binding requested"
 * apart from "binding requested but missing".
 */
export interface MarkComponentProps {
  attributes: DirectiveAttributes;
  children?: ReactNode;
  data?: unknown;
  dataStatus?: ValueStatus;
}

/**
 * One registry entry: the component that renders a directive, plus whether
 * it is meant to be used inline (text directive, `:name[...]`) vs as a
 * block (leaf/container directive, `::name{...}` / `:::name{...} ... :::`).
 * `inline` is descriptive metadata for pack authors and tooling; the
 * renderer itself does not require it to place the component correctly,
 * since every component controls its own root element.
 */
export interface RegistryEntry {
  component: ComponentType<MarkComponentProps>;
  inline?: boolean;
}

/** Directive name -> component registration. */
export type Registry = Record<string, RegistryEntry>;

/**
 * Creates a Registry from a plain object of entries. The returned map has a
 * `null` prototype so a directive named `constructor`, `toString`,
 * `valueOf`, `hasOwnProperty`, etc. cannot resolve to an inherited
 * `Object.prototype` member — only entries actually registered here are
 * ever found (see also the `Object.hasOwn` guard at the lookup site in
 * `render.tsx`, which protects even plain-object registries).
 */
export function createRegistry(entries: Registry = {}): Registry {
  return Object.assign(Object.create(null) as Registry, entries);
}

/**
 * Merges any number of registries, later ones taking precedence. The
 * returned map has a `null` prototype, matching `createRegistry`, so the
 * public API is symmetric: every `Registry` this module hands back is safe
 * from prototype-chain collisions regardless of which factory produced it.
 */
export function mergeRegistries(...registries: Registry[]): Registry {
  return Object.assign(Object.create(null) as Registry, ...registries);
}
