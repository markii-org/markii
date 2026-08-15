import type { ComponentType, ReactNode } from 'react';

/**
 * Attributes parsed off a directive, e.g. `{type=warning title="Careful"}`.
 * A bare attribute (present but valueless, e.g. `{collapsed}`) arrives as
 * `null`. A key that was never written is simply absent from the object.
 */
export type DirectiveAttributes = Record<string, string | null | undefined>;

/**
 * Props every registry component receives. Attributes arrive as raw
 * strings (or null for bare attributes) — components are responsible for
 * parsing, validating, and defaulting their own attributes; `children` is
 * the directive's inner markdown, already rendered to React elements.
 */
export interface SmdComponentProps {
  attributes: DirectiveAttributes;
  children?: ReactNode;
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
  component: ComponentType<SmdComponentProps>;
  inline?: boolean;
}

/** Directive name -> component registration. */
export type Registry = Record<string, RegistryEntry>;

/** Creates a Registry from a plain object of entries. */
export function createRegistry(entries: Registry = {}): Registry {
  return { ...entries };
}

/** Merges any number of registries, later ones taking precedence. */
export function mergeRegistries(...registries: Registry[]): Registry {
  return Object.assign({}, ...registries) as Registry;
}
