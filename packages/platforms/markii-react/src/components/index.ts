import { getContract } from '@markii/stdlib';
import type { Registry, RegistryEntry } from '../registry.js';
import { Badge } from './badge.js';
import { Callout } from './callout.js';
import { Card } from './card.js';
import { Cell } from './cell.js';
import { Chart } from './chart.js';
import { Details } from './details.js';
import { Divider } from './divider.js';
import { Figure } from './figure.js';
import { Kbd } from './kbd.js';
import {
  createLayoutWrapper,
  layoutWrapperPresetAxis,
} from './layout-wrapper.js';
import type { LayoutWrapperPreset } from './layout-wrapper.js';
import { Progress } from './progress.js';
import { Rating } from './rating.js';
import { Row } from './row.js';
import { Stat } from './stat.js';
import { Tab } from './tab.js';
import { Tabs } from './tabs.js';
import { Table } from './table.js';

export { Badge } from './badge.js';
export type { BadgeVariant } from './badge.js';
export { Callout } from './callout.js';
export type { CalloutType } from './callout.js';
export { Card } from './card.js';
export { Cell } from './cell.js';
export { Chart } from './chart.js';
export { Details } from './details.js';
export { Divider } from './divider.js';
export { Figure } from './figure.js';
export { Kbd } from './kbd.js';
export {
  createLayoutWrapper,
  layoutWrapperPresetAxis,
  LAYOUT_WRAPPER_PRESETS,
} from './layout-wrapper.js';
export type { LayoutWrapperPreset } from './layout-wrapper.js';
export { Progress } from './progress.js';
export { Rating } from './rating.js';
export { Row } from './row.js';
export { Stat } from './stat.js';
export { Tab, DEFAULT_TAB_LABEL } from './tab.js';
export { Tabs } from './tabs.js';
export { Table } from './table.js';
export { ScriptMarker } from './script-marker.js';
export type { ScriptMarkerProps } from './script-marker.js';
export { UnknownDirective } from './unknown-directive.js';
export type {
  DirectiveFallbackReason,
  UnknownDirectiveProps,
} from './unknown-directive.js';
export { ValueDirective } from './value-directive.js';
export type { ValueDirectiveProps } from './value-directive.js';

/**
 * Derives a registry entry's `inline` flag from `@markii/stdlib`'s
 * standard-component contract for `name`, rather than hardcoding it here:
 * `@markii/stdlib`'s `ComponentKind` is the source of truth for whether a
 * standard component is written as a text directive (`kind: 'inline'` ->
 * `inline: true`) or a leaf/container directive (`kind: 'leaf' |
 * 'container'` -> `inline: false`). The component *implementation* still
 * lives here in `@markii/react` — only the kind classification is pulled
 * from the neutral contract (docs/integration.md/§13.6). Falls back to `false`
 * if `name` has no standard contract, matching the leaf/container default.
 */
function inlineFromContract(name: string): boolean {
  return getContract(name)?.kind === 'inline';
}

/**
 * One layout-wrapper registration: the shared wrapper component bound to
 * `preset`, plus the `layout` axis that preset sets by its own name. The
 * axis is what tells `render.tsx` to drop a same-axis attribute and hand the
 * other axis down as `layoutClassName` instead of wrapping the component in
 * a second `<div>` (see `RegistryEntry.layout`). Derived per preset rather
 * than written out seven times, so a wrapper cannot be registered against
 * the wrong axis.
 */
function layoutWrapperEntry(preset: LayoutWrapperPreset): RegistryEntry {
  return {
    component: createLayoutWrapper(preset),
    inline: inlineFromContract(preset),
    layout: layoutWrapperPresetAxis(preset),
  };
}

/** The built-in demo components, pre-registered under their names. */
export const defaultRegistry: Registry = {
  callout: { component: Callout, inline: inlineFromContract('callout') },
  kbd: { component: Kbd, inline: inlineFromContract('kbd') },
  rating: { component: Rating, inline: inlineFromContract('rating') },
  divider: { component: Divider, inline: inlineFromContract('divider') },
  details: { component: Details, inline: inlineFromContract('details') },
  card: { component: Card, inline: inlineFromContract('card') },
  badge: { component: Badge, inline: inlineFromContract('badge') },
  figure: { component: Figure, inline: inlineFromContract('figure') },
  tabs: { component: Tabs, inline: inlineFromContract('tabs') },
  tab: { component: Tab, inline: inlineFromContract('tab') },
  stat: { component: Stat, inline: inlineFromContract('stat') },
  progress: { component: Progress, inline: inlineFromContract('progress') },
  chart: { component: Chart, inline: inlineFromContract('chart') },
  row: { component: Row, inline: inlineFromContract('row') },
  cell: { component: Cell, inline: inlineFromContract('cell') },
  table: { component: Table, inline: inlineFromContract('table') },
  center: layoutWrapperEntry('center'),
  left: layoutWrapperEntry('left'),
  right: layoutWrapperEntry('right'),
  wide: layoutWrapperEntry('wide'),
  narrow: layoutWrapperEntry('narrow'),
  full: layoutWrapperEntry('full'),
  fit: layoutWrapperEntry('fit'),
};
