import { getContract } from '@markii/stdlib';
import type { HtmlRegistry } from '../registry.js';
import { createHtmlRegistry } from '../registry.js';
import { Badge } from './badge.js';
import { Callout } from './callout.js';
import { Card } from './card.js';
import { Cell } from './cell.js';
import { Chart } from './chart.js';
import { Details } from './details.js';
import { Divider } from './divider.js';
import { Figure } from './figure.js';
import { Kbd } from './kbd.js';
import { createLayoutWrapper } from './layout-wrapper.js';
import { Progress } from './progress.js';
import { Rating } from './rating.js';
import { Row } from './row.js';
import { Stat } from './stat.js';
import { Tab } from './tab.js';
import { Tabs } from './tabs.js';

export { Badge } from './badge.js';
export type { BadgeVariant } from './badge.js';
export { Callout } from './callout.js';
export type { CalloutType } from './callout.js';
export { Card } from './card.js';
export { Cell } from './cell.js';
export { Chart } from './chart.js';
export { Details } from './details.js';
export { Divider } from './divider.js';
export type { DividerVariant } from './divider.js';
export { Figure } from './figure.js';
export { Kbd } from './kbd.js';
export {
  createLayoutWrapper,
  LAYOUT_WRAPPER_PRESETS,
} from './layout-wrapper.js';
export type { LayoutWrapperPreset } from './layout-wrapper.js';
export { Progress } from './progress.js';
export { Rating } from './rating.js';
export { Row } from './row.js';
export { Stat } from './stat.js';
export { Tab, DEFAULT_TAB_LABEL, tabPanel } from './tab.js';
export { Tabs } from './tabs.js';

/**
 * Derives a registry entry's `inline` flag from `@markii/stdlib`'s standard
 * component contract for `name`, matching `@markii/react`'s
 * `inlineFromContract`: `@markii/stdlib`'s `ComponentKind` is the source of
 * truth for whether a standard component is written as a text directive
 * (`kind: 'inline'` -> `inline: true`) or a leaf/container directive
 * (`kind: 'leaf' | 'container'` -> `inline: false`). Falls back to `false`
 * if `name` has no standard contract.
 */
function inlineFromContract(name: string): boolean {
  return getContract(name)?.kind === 'inline';
}

/**
 * The built-in standard components, pre-registered under their names —
 * matching `@markii/react`'s `defaultRegistry` in full, including the
 * data-bound `stat`/`progress`/`chart` trio now that this engine's
 * `HtmlRenderContext` carries a value-resolution seam (`./stat.js`,
 * `./progress.js`, `./chart.js`; see `render.ts`'s `resolveDataAttribute`).
 */
export const defaultHtmlRegistry: HtmlRegistry = createHtmlRegistry({
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
  row: { component: Row, inline: inlineFromContract('row') },
  cell: { component: Cell, inline: inlineFromContract('cell') },
  stat: { component: Stat, inline: inlineFromContract('stat') },
  progress: { component: Progress, inline: inlineFromContract('progress') },
  chart: { component: Chart, inline: inlineFromContract('chart') },
  center: {
    component: createLayoutWrapper('center'),
    inline: inlineFromContract('center'),
  },
  left: {
    component: createLayoutWrapper('left'),
    inline: inlineFromContract('left'),
  },
  right: {
    component: createLayoutWrapper('right'),
    inline: inlineFromContract('right'),
  },
  wide: {
    component: createLayoutWrapper('wide'),
    inline: inlineFromContract('wide'),
  },
  narrow: {
    component: createLayoutWrapper('narrow'),
    inline: inlineFromContract('narrow'),
  },
  full: {
    component: createLayoutWrapper('full'),
    inline: inlineFromContract('full'),
  },
});
