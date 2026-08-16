/**
 * The neutral, framework-agnostic definition of Mark's standard component
 * *contracts* (DESIGN.md §13.3/§13.6): name + kind + attribute schema +
 * semantics, as pure data — zero React, zero dependency on any other
 * `@markii/*` package. A renderer (today `@markii/react`, tomorrow a
 * hypothetical `@markii/gnome`) implements these same contracts against its
 * own component framework; this module is the seam that makes "one format,
 * many renderers" a checkable fact rather than a hope.
 *
 * A contract never describes markup, styling, or a component
 * implementation — only what a directive named `name` means: how it is
 * written (`kind`, matching the three directive forms from DESIGN.md §2/§13:
 * `inline` -> `:name[...]`, `leaf` -> `::name{...}`, `container` ->
 * `:::name{...} ... :::`) and what attributes it accepts.
 */

/**
 * Which of the three directive forms a component is written as. Matches
 * `remark-directive`'s three node types one-to-one:
 * - `inline`    — text directive, `:name[...]`
 * - `leaf`      — leaf directive, `::name{...}` (no body)
 * - `container` — container directive, `:::name{...} ... :::` (block body)
 */
export type ComponentKind = 'inline' | 'leaf' | 'container';

/**
 * Schema for one directive attribute. All directive attributes arrive as
 * raw strings (or `null` for a bare attribute) — DESIGN.md never gives
 * directives a typed attribute grammar (Architecture rule 5: "no
 * expressions, conditionals, or loops in attributes"). `type` is kept as an
 * explicit field, rather than assumed, so the schema has somewhere to grow
 * if a future spec revision adds a second attribute kind; today it is
 * always `'string'`.
 */
export interface AttributeSchema {
  type: 'string';
  /** Whether the directive is invalid/incomplete without this attribute. Absent or `false` means optional. */
  required?: boolean;
  /** The exact set of allowed string values, if the attribute is a closed enum. Absent means any string is accepted. */
  enum?: readonly string[];
  /** Human-readable semantics: what the attribute controls, and its default/fallback behavior when absent or invalid. */
  description: string;
}

/** One standard component's full contract: name, directive form, attribute schema, and semantics. */
export interface ComponentContract {
  name: string;
  kind: ComponentKind;
  attributes: Record<string, AttributeSchema>;
  description: string;
}

/**
 * The standard component set, seeded from the components that ship with
 * `@markii/react` today (`packages/platforms/markii-react/src/components/
 * {callout,kbd,rating,details,card,badge,figure,tabs,tab}.tsx`). Each
 * contract was written by reading the real implementation — `kind` from how
 * the component is registered in `defaultRegistry`, `attributes` from
 * exactly the props the component reads (no invented attributes).
 *
 * Keyed by directive name, matching `defaultRegistry`'s shape so a renderer
 * can iterate `Object.entries(STANDARD_COMPONENTS)` the same way it iterates
 * its own registry.
 */
export const STANDARD_COMPONENTS: Record<string, ComponentContract> = {
  callout: {
    name: 'callout',
    kind: 'container',
    attributes: {
      type: {
        type: 'string',
        required: false,
        enum: ['info', 'warning', 'danger'],
        description:
          'Visual/semantic variant, selecting the icon and color. Defaults to `info` when absent or not one of the allowed values.',
      },
      title: {
        type: 'string',
        required: false,
        description:
          'Optional header text shown above the body. Absent means no header line is rendered.',
      },
    },
    description:
      "A colored box for an aside, warning, or danger note. Body is the directive's inner markdown, rendered as-is.",
  },
  kbd: {
    name: 'kbd',
    kind: 'inline',
    attributes: {},
    description:
      'A styled keycap for an inline text directive, e.g. `:kbd[Ctrl+S]`. Takes no attributes; its inner content is the key label.',
  },
  rating: {
    name: 'rating',
    kind: 'leaf',
    attributes: {
      value: {
        type: 'string',
        required: false,
        description:
          'Number of filled stars, as a numeric string. Defaults to `0`; non-numeric input falls back to the default; the effective value is clamped to `[0, max]`.',
      },
      max: {
        type: 'string',
        required: false,
        description:
          'Total number of stars, as a numeric string. Defaults to `5`; non-numeric input falls back to the default; the effective value is clamped to `[1, 20]`.',
      },
    },
    description:
      'A leaf directive rendering a row of stars, e.g. `::rating{value=3 max=5}`. Has no body — both attributes are optional and degrade gracefully rather than throwing.',
  },
  details: {
    name: 'details',
    kind: 'container',
    attributes: {
      title: {
        type: 'string',
        required: false,
        description:
          'Summary text shown on the always-visible header. Defaults to `Details` when absent.',
      },
      open: {
        type: 'string',
        required: false,
        description:
          'Bare attribute (e.g. `{open}`). When present, the disclosure starts expanded; absent means it starts folded.',
      },
    },
    description:
      'A collapsible disclosure, e.g. `:::details{title="More"} ... :::`. Body is the directive\'s inner markdown, hidden until expanded.',
  },
  card: {
    name: 'card',
    kind: 'container',
    attributes: {
      title: {
        type: 'string',
        required: false,
        description:
          'Optional header text shown above the body. Absent means no title line is rendered.',
      },
    },
    description:
      'A titled panel, e.g. `:::card{title="Notes"} ... :::`. Body is the directive\'s inner markdown, rendered as-is.',
  },
  badge: {
    name: 'badge',
    kind: 'inline',
    attributes: {
      variant: {
        type: 'string',
        required: false,
        enum: ['neutral', 'info', 'success', 'warning', 'danger'],
        description:
          'Visual/semantic variant, selecting the pill color. Defaults to `neutral` when absent or not one of the allowed values.',
      },
    },
    description:
      'A status pill for an inline text directive, e.g. `:badge[New]{variant=success}`. Its inner content is the label text.',
  },
  figure: {
    name: 'figure',
    kind: 'container',
    attributes: {
      src: {
        type: 'string',
        required: true,
        description:
          'Image URL. Required; an unsafe scheme (e.g. `javascript:`) is dropped and no image is rendered.',
      },
      alt: {
        type: 'string',
        required: false,
        description:
          'Image alt text. Defaults to the empty string when absent.',
      },
    },
    description:
      'An image with a rich caption, e.g. `:::figure{src="cat.png" alt="A cat"} A cat, napping. ::: `. Body is the directive\'s inner markdown, rendered as the caption.',
  },
  tabs: {
    name: 'tabs',
    kind: 'container',
    attributes: {},
    description:
      'A tabbed panel switcher, e.g. `::::tabs :::tab{label="A"} ... ::: :::tab{label="B"} ... ::: ::::`. Takes no attributes of its own; its body is a sequence of `tab` containers, one per panel, and it shows only the active one. The enclosing fence must use MORE colons than its `tab` children (directive container nesting rule), hence `::::tabs` wrapping `:::tab`.',
  },
  tab: {
    name: 'tab',
    kind: 'container',
    attributes: {
      label: {
        type: 'string',
        required: false,
        description:
          'Tab button text, read by the enclosing `tabs` component. Defaults to `Tab` when absent.',
      },
    },
    description:
      'One panel of a `tabs` component, e.g. `:::tab{label="A"} ... :::`. Body is the directive\'s inner markdown, shown only while this tab is active. Rendered standalone (outside a `tabs` parent) it simply shows its panel.',
  },
};

/**
 * Looks `name` up in `STANDARD_COMPONENTS`, returning `undefined` if it
 * isn't a standard component. Guards against `name` being `'__proto__'`,
 * `'constructor'`, `'toString'`, `'hasOwnProperty'`, etc. resolving through
 * the prototype chain to an inherited `Object.prototype` member instead of
 * correctly reporting "not found" — the same defense `@markii/react`'s
 * registry (`createRegistry`/lookup in `render.tsx`) and `@markii/runtime`'s
 * `ValueStore` already apply, via `Object.hasOwn` rather than `in`/bracket
 * access alone.
 */
export function getContract(name: string): ComponentContract | undefined {
  return Object.hasOwn(STANDARD_COMPONENTS, name)
    ? STANDARD_COMPONENTS[name]
    : undefined;
}
