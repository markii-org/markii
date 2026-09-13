import { getContract } from '@markii/stdlib';
import type { AnsiRegistry, AnsiRegistryEntry } from '../registry.js';
import { createAnsiRegistry } from '../registry.js';
import { Badge } from './badge.js';
import { Callout } from './callout.js';
import { Card } from './card.js';
import { Cell } from './cell.js';
import { Chart } from './chart.js';
import { Details } from './details-string.js';
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
import { Tabs } from './tabs-string.js';
import { Table } from './table.js';

export { Badge } from './badge.js';
export type { BadgeVariant } from './badge.js';
export { Callout } from './callout.js';
export type { CalloutType } from './callout.js';
export { Card } from './card.js';
export { Cell } from './cell.js';
export { Chart } from './chart.js';
export { Details } from './details-string.js';
export { InteractiveDetails } from './details.js';
export { Divider } from './divider.js';
export type { DividerVariant } from './divider.js';
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
export { Row, ROW_COLUMN_THRESHOLD, resolveRowLayout } from './row.js';
export { Stat } from './stat.js';
export { Tab, DEFAULT_TAB_LABEL } from './tab.js';
export { Tabs } from './tabs-string.js';
export { InteractiveTabs } from './tabs.js';
export { Table } from './table.js';
export {
  drawTableGrid,
  measureTableGridWidth,
  MIN_COLUMN_WIDTH,
} from './table-grid.js';

/**
 * Derives a registry entry's `inline` flag from `@markii/stdlib`'s standard
 * component contract for `name`: `kind: 'inline'` -> `inline: true`,
 * otherwise `false`. Falls back to `false` if `name` has no standard
 * contract.
 */
function inlineFromContract(name: string): boolean {
  return getContract(name)?.kind === 'inline';
}

/**
 * One layout-wrapper registration: the shared wrapper component bound to
 * `preset`, plus the `layout` axis that preset sets by its own name.
 */
function layoutWrapperEntry(preset: LayoutWrapperPreset): AnsiRegistryEntry {
  return {
    component: createLayoutWrapper(preset),
    inline: inlineFromContract(preset),
    layout: layoutWrapperPresetAxis(preset),
  };
}

/**
 * The built-in standard components, pre-registered under their names: the
 * same 23 names as `@markii/html`'s `defaultHtmlRegistry` and
 * `@markii/react`'s `defaultRegistry`. `card`, `callout`, `divider`, and
 * `table` are marked `selfLayout` because they draw a single long
 * frame/bar/rule/grid a generic post-render `applyLayout` narrow/pad would
 * corrupt or hard-break mid-glyph. `row`, `tabs`, and `details` are the
 * three directives `render.tsx` gives real Ink layout/state to directly
 * (see `registry.ts`'s and `render.tsx`'s doc comments); their REGISTERED
 * `component` here is the STRING-mode fallback, reached only when one of
 * them is nested inside a self-drawing container's own body.
 */
export const defaultAnsiRegistry: AnsiRegistry = createAnsiRegistry({
  callout: {
    component: Callout,
    inline: inlineFromContract('callout'),
    selfLayout: true,
  },
  kbd: { component: Kbd, inline: inlineFromContract('kbd') },
  rating: { component: Rating, inline: inlineFromContract('rating') },
  divider: {
    component: Divider,
    inline: inlineFromContract('divider'),
    selfLayout: true,
  },
  details: { component: Details, inline: inlineFromContract('details') },
  card: {
    component: Card,
    inline: inlineFromContract('card'),
    selfLayout: true,
  },
  badge: { component: Badge, inline: inlineFromContract('badge') },
  figure: { component: Figure, inline: inlineFromContract('figure') },
  tabs: { component: Tabs, inline: inlineFromContract('tabs') },
  tab: { component: Tab, inline: inlineFromContract('tab') },
  row: { component: Row, inline: inlineFromContract('row') },
  cell: { component: Cell, inline: inlineFromContract('cell') },
  table: {
    component: Table,
    inline: inlineFromContract('table'),
    selfLayout: true,
  },
  stat: { component: Stat, inline: inlineFromContract('stat') },
  progress: { component: Progress, inline: inlineFromContract('progress') },
  chart: { component: Chart, inline: inlineFromContract('chart') },
  center: layoutWrapperEntry('center'),
  left: layoutWrapperEntry('left'),
  right: layoutWrapperEntry('right'),
  wide: layoutWrapperEntry('wide'),
  narrow: layoutWrapperEntry('narrow'),
  full: layoutWrapperEntry('full'),
  fit: layoutWrapperEntry('fit'),
});
