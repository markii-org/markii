import { getContract } from '@markii/stdlib';
import type { Registry } from '../registry';
import { Callout } from './callout';
import { Kbd } from './kbd';
import { Rating } from './rating';

export { Callout } from './callout';
export type { CalloutType } from './callout';
export { Kbd } from './kbd';
export { Rating } from './rating';
export { ScriptMarker } from './script-marker';
export type { ScriptMarkerProps } from './script-marker';
export { UnknownDirective } from './unknown-directive';
export type { UnknownDirectiveProps } from './unknown-directive';
export { ValueDirective } from './value-directive';
export type { ValueDirectiveProps } from './value-directive';

/**
 * Derives a registry entry's `inline` flag from `@markii/stdlib`'s
 * standard-component contract for `name`, rather than hardcoding it here:
 * `@markii/stdlib`'s `ComponentKind` is the source of truth for whether a
 * standard component is written as a text directive (`kind: 'inline'` ->
 * `inline: true`) or a leaf/container directive (`kind: 'leaf' |
 * 'container'` -> `inline: false`). The component *implementation* still
 * lives here in `@markii/react` — only the kind classification is pulled
 * from the neutral contract (DESIGN.md §13.3/§13.6). Falls back to `false`
 * if `name` has no standard contract, matching the leaf/container default.
 */
function inlineFromContract(name: string): boolean {
  return getContract(name)?.kind === 'inline';
}

/** The three built-in demo components, pre-registered under their names. */
export const defaultRegistry: Registry = {
  callout: { component: Callout, inline: inlineFromContract('callout') },
  kbd: { component: Kbd, inline: inlineFromContract('kbd') },
  rating: { component: Rating, inline: inlineFromContract('rating') },
};
