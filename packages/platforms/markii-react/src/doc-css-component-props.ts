/**
 * Tier 3 of `doc.css`'s theming surface: component properties a host MAY set
 * and never has to map. `doc.css` never declares one. It only reads one as
 * `var(--mk-x, <default>)`, so a host that sets nothing gets the stylesheet's
 * own look. `doc-css-component-props.test.ts` holds this table against the
 * stylesheet in both directions.
 */
export interface ComponentProp {
  /** The custom property name. */
  name: string;
  /** The fallback written in `doc.css`, verbatim. */
  defaultValue: string;
  /** The CSS property or behavior the value controls. */
  changes: string;
}

export const COMPONENT_PROPS: readonly ComponentProp[] = [
  {
    name: '--mk-stat-value-size',
    defaultValue: '1.8em',
    changes: 'font-size of the stat value',
  },
  {
    name: '--mk-stat-value-weight',
    defaultValue: '700',
    changes: 'font-weight of the stat value',
  },
  {
    name: '--mk-stat-value-font',
    defaultValue: 'inherit',
    changes: 'font-family of the stat value',
  },
  {
    name: '--mk-stat-label-size',
    defaultValue: '0.85em',
    changes: 'font-size of the stat label',
  },
  {
    name: '--mk-callout-accent-width',
    defaultValue: '4px',
    changes: 'left border width of a callout',
  },
  {
    name: '--mk-card-border-width',
    defaultValue: '1px',
    changes: 'border width of a card',
  },
  {
    name: '--mk-card-radius',
    defaultValue: '8px',
    changes: 'corner radius of a card',
  },
  {
    name: '--mk-card-padding',
    defaultValue: '1rem',
    changes: 'padding of a card',
  },
  {
    name: '--mk-card-bg',
    defaultValue: 'var(--mk-raised)',
    changes: 'background of a card',
  },
  {
    name: '--mk-stale-opacity',
    defaultValue: '0.82',
    changes: 'opacity of a stale stat, progress, chart or table',
  },
  {
    name: '--mk-control-min-size',
    defaultValue: 'auto',
    changes:
      'min-height of the details summary, the script marker summary and the tab buttons',
  },
  {
    name: '--mk-rhythm',
    defaultValue: '1rem',
    changes: 'vertical gap between the top-level blocks of a document',
  },
  {
    name: '--mk-rhythm-heading',
    defaultValue: 'var(--mk-rhythm, 1rem)',
    changes: 'vertical gap above a top-level h2 or h3',
  },
];
