import { getContract } from '@markii/stdlib';
import type { Registry } from '../registry';
import { Badge } from './badge';
import { Callout } from './callout';
import { Card } from './card';
import { Chart } from './chart';
import { Details } from './details';
import { Figure } from './figure';
import { Kbd } from './kbd';
import { Progress } from './progress';
import { Rating } from './rating';
import { Stat } from './stat';
import { Tab } from './tab';
import { Tabs } from './tabs';

export { Badge } from './badge';
export type { BadgeVariant } from './badge';
export { Callout } from './callout';
export type { CalloutType } from './callout';
export { Card } from './card';
export { Chart } from './chart';
export { Details } from './details';
export { Figure } from './figure';
export { Kbd } from './kbd';
export { Progress } from './progress';
export { Rating } from './rating';
export { Stat } from './stat';
export { Tab, DEFAULT_TAB_LABEL } from './tab';
export { Tabs } from './tabs';
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

/** The built-in demo components, pre-registered under their names. */
export const defaultRegistry: Registry = {
  callout: { component: Callout, inline: inlineFromContract('callout') },
  kbd: { component: Kbd, inline: inlineFromContract('kbd') },
  rating: { component: Rating, inline: inlineFromContract('rating') },
  details: { component: Details, inline: inlineFromContract('details') },
  card: { component: Card, inline: inlineFromContract('card') },
  badge: { component: Badge, inline: inlineFromContract('badge') },
  figure: { component: Figure, inline: inlineFromContract('figure') },
  tabs: { component: Tabs, inline: inlineFromContract('tabs') },
  tab: { component: Tab, inline: inlineFromContract('tab') },
  stat: { component: Stat, inline: inlineFromContract('stat') },
  progress: { component: Progress, inline: inlineFromContract('progress') },
  chart: { component: Chart, inline: inlineFromContract('chart') },
};
