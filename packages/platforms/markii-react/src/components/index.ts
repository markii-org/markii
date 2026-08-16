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

/** The three built-in demo components, pre-registered under their names. */
export const defaultRegistry: Registry = {
  callout: { component: Callout, inline: false },
  kbd: { component: Kbd, inline: true },
  rating: { component: Rating, inline: false },
};
