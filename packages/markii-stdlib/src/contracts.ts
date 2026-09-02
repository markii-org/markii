/**
 * The neutral, framework-agnostic definition of Mark's standard component
 * *contracts* (docs/integration.md/§13.6): name + kind + attribute schema +
 * semantics, as pure data — zero React, zero dependency on any other
 * `@markii/*` package. A renderer (today `@markii/react`, tomorrow a
 * hypothetical `@markii/gnome`) implements these same contracts against its
 * own component framework; this module is the seam that makes "one format,
 * many renderers" a checkable fact rather than a hope.
 *
 * A contract never describes markup, styling, or a component
 * implementation — only what a directive named `name` means: how it is
 * written (`kind`, matching the three directive forms from docs/format.md/§13:
 * `inline` -> `:name[...]`, `leaf` -> `::name{...}`, `container` ->
 * `:::name{...} ... :::`) and what attributes it accepts.
 */
import {
  LAYOUT_ATTRIBUTES,
  layoutWrapperAxis,
  otherLayoutAxis,
} from './layout.js';
import { TEXT_ALIGN_ATTRIBUTE } from './text-align.js';
import { DECIMALS_ATTRIBUTE, FORMAT_ATTRIBUTE } from './value-format.js';

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
 * raw strings (or `null` for a bare attribute) — docs/spec.md never gives
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
 * Builds one of docs/format.md's layout-wrapper container contracts,
 * `center`/`left`/`right`/`wide`/`narrow`/`full`/`fit`, which are otherwise
 * identical in shape and differ only in `name`, the preset-specific half of
 * `description`, and which of the two layout axes they leave open. A tiny
 * helper rather than one hand-copied literal per preset, since a typo in
 * one copy's `kind`/`attributes` would otherwise be easy to miss across a
 * run of near-duplicate blocks.
 *
 * A wrapper decides ONE axis by its name and accepts the OTHER as an
 * attribute (docs/spec.md §3), so an alignment wrapper declares `width` and
 * a width wrapper declares `align`, taken from `./layout.ts`'s one
 * definition of those two schemas. An attribute for the wrapper's own axis
 * is deliberately absent from the contract: the name already decided it,
 * and writing it is ignored rather than an error.
 *
 * `whatItDoes` is the preset-specific clause (e.g. "Centers narrower-than-
 * column plain markdown..."); the shared clause about why these exist (the
 * attribute mechanism cannot reach plain markdown) is appended identically
 * for all of them.
 */
function layoutWrapperContract(
  name: string,
  whatItDoes: string,
): ComponentContract {
  const ownAxis = layoutWrapperAxis(name);
  if (ownAxis === undefined) {
    throw new Error(`"${name}" is not a layout-wrapper name`);
  }
  const openAxis = otherLayoutAxis(ownAxis);

  return {
    name,
    kind: 'container',
    attributes: { [openAxis]: LAYOUT_ATTRIBUTES[openAxis] },
    description:
      `${whatItDoes} A wrapper reaches plain markdown that a directive ` +
      'attribute structurally cannot: a GFM table or a bare image has no ' +
      '`{...}` to write `width=`/`align=` into. It sets one of the two ' +
      `layout axes by its name and takes the other, \`${openAxis}\`, as an ` +
      `attribute, so \`:::${name}{${openAxis}=...}\` applies both to the ` +
      `one scope. An \`${ownAxis}\` attribute is ignored here, since the ` +
      'name already decided that axis. Nesting two wrappers composes the ' +
      'same way, e.g. `::::center :::narrow ... ::: ::::` (the outer fence ' +
      'needs more colons than the inner one).',
  };
}

/**
 * The standard component set, seeded from the components that ship with
 * `@markii/react` today (`packages/platforms/markii-react/src/components/
 * {callout,kbd,rating,divider,details,card,badge,figure,tabs,tab}.tsx`). Each
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
      text: TEXT_ALIGN_ATTRIBUTE,
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
  divider: {
    name: 'divider',
    kind: 'leaf',
    attributes: {
      label: {
        type: 'string',
        required: false,
        description:
          'Optional short text shown in the break, centered unless `label-align` says otherwise. Absent or empty means an unlabeled divider.',
      },
      variant: {
        type: 'string',
        required: false,
        enum: ['line', 'dots', 'ornament'],
        description:
          'Which break to draw: a solid hairline, a dotted hairline, or a centered ornament with no hairline. Defaults to `line` when absent or not one of the allowed values.',
      },
      'label-align': {
        type: 'string',
        required: false,
        enum: ['left', 'center', 'right'],
        description:
          'Where the label sits along the rule. Defaults to `center` when absent or not one of the allowed values.',
      },
    },
    description:
      'A leaf directive drawing a section break, e.g. `::divider{label="Part 2" variant="dots"}`. Has no body, and every attribute is optional. A plain `---` thematic break keeps its own CommonMark meaning; this directive is for a break that carries a label or a chosen look.',
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
      text: TEXT_ALIGN_ATTRIBUTE,
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
  stat: {
    name: 'stat',
    kind: 'leaf',
    attributes: {
      value: {
        type: 'string',
        required: false,
        description:
          "The headline value, shown large. Overridden by a bound `data=` value/object's own `value` field when both are present. Absent value (from either source) renders `—`.",
      },
      label: {
        type: 'string',
        required: false,
        description:
          "Caption shown under the value. Overridden by a bound `data=` object's `label` field when both are present. Absent means no caption line is rendered.",
      },
      delta: {
        type: 'string',
        required: false,
        description:
          "Optional secondary text (e.g. a change amount) shown next to the value. Overridden by a bound `data=` object's `delta` field when both are present.",
      },
      trend: {
        type: 'string',
        required: false,
        enum: ['up', 'down', 'flat'],
        description:
          "Colors/annotates `delta` as an increase, decrease, or no change. Overridden by a bound `data=` object's `trend` field when both are present; absent/invalid means no trend styling.",
      },
      format: FORMAT_ATTRIBUTE,
      decimals: DECIMALS_ATTRIBUTE,
    },
    description:
      'A leaf directive rendering a big value plus label, e.g. `::stat{value=42 label="stars" trend=up}`. Data binding (§8): `data=name` resolves against the value store — a number/string value supplies `value` directly; an object may supply `value`/`label`/`delta`/`trend` fields (explicit attributes on the directive always take precedence over the bound object\'s fields). Degrades to `—` when both the attribute and the bound value are absent — never throws. `format`/`decimals` (docs/format.md) format the headline value before display.',
  },
  progress: {
    name: 'progress',
    kind: 'leaf',
    attributes: {
      value: {
        type: 'string',
        required: false,
        description:
          "Current amount, as a numeric string. Overridden by a bound `data=` number, or a bound object's `value` field, when present. Non-numeric/NaN/Infinity input is treated as `0`; the effective value is clamped to `[0, max]`.",
      },
      max: {
        type: 'string',
        required: false,
        description:
          "The amount `value` is measured against, as a numeric string. Defaults to `1`. Overridden by a bound object's `max` field when present. Non-numeric/NaN/Infinity/non-positive input falls back to the default.",
      },
      label: {
        type: 'string',
        required: false,
        description:
          'Optional caption shown above/alongside the bar. Absent means no caption line is rendered.',
      },
      format: FORMAT_ATTRIBUTE,
      decimals: DECIMALS_ATTRIBUTE,
    },
    description:
      'A leaf directive rendering a meter bar, e.g. `::progress{value=3 max=5 label="tasks"}`. Data binding (§8): `data=name` resolves against the value store — a bare number supplies `value` directly; an object may supply `value`/`max` fields (explicit attributes take precedence). Parses defensively and clamps rather than throwing; missing/invalid input renders an empty (0%) bar. `format`/`decimals` (docs/format.md), when present, format the fraction `value/max` for the percent readout in place of the default rounded integer percent; absent means the unchanged default (`42%`).',
  },
  chart: {
    name: 'chart',
    kind: 'leaf',
    attributes: {
      kind: {
        type: 'string',
        required: false,
        enum: ['line', 'bar'],
        description:
          'Chart form: a connected line through the points, or a bar per point. Defaults to `line` when absent or not one of the allowed values.',
      },
      values: {
        type: 'string',
        required: false,
        description:
          'Comma-separated numbers for static authoring, e.g. `values="1,3,2,5"`. Ignored in favor of a bound `data=` array when both are present. Non-numeric entries are dropped.',
      },
    },
    description:
      'A leaf directive rendering a minimal hand-rolled inline SVG chart, e.g. `::chart{kind=line values="1,3,2,5"}`. Sizes to its container — use docs/format.md\'s `width`/`align` layout presets to control its footprint, not a pixel attribute. Data binding (§8): `data=name` resolves against the value store — expects an array of numbers (typically a Lua script returning a table), or an array of `{value}` objects. Non-finite/non-numeric entries are filtered out and the point count is capped; an empty or all-invalid series renders a small neutral empty state rather than a broken chart. Never throws, and never places unescaped text into the emitted SVG markup.',
  },
  table: {
    name: 'table',
    kind: 'leaf',
    attributes: {
      columns: {
        type: 'string',
        required: false,
        description:
          "Comma-separated key list, shown in that order instead of the bound data's own key order. A key no row has renders an empty cell for that column. Only meaningful for an array-of-objects or single-object binding.",
      },
      caption: {
        type: 'string',
        required: false,
        description:
          'Optional caption text shown with the table. Absent means no caption.',
      },
      limit: {
        type: 'string',
        required: false,
        description:
          'Maximum number of rows shown, as a positive integer. An absent, non-integer, or non-positive value is ignored and every row is shown.',
      },
      text: TEXT_ALIGN_ATTRIBUTE,
      format: FORMAT_ATTRIBUTE,
      decimals: DECIMALS_ATTRIBUTE,
    },
    description:
      'A leaf directive rendering a data-bound table, e.g. `::table{data=users columns="name,role" limit=10}`. Data binding (§8): `data=name` resolves against the value store — an array of objects becomes columns from the union of keys in first-seen order (or `columns=`, when given); an array of arrays becomes rows as given; an array of primitives becomes a single column; a single object becomes key/value rows. `format`/`decimals` (docs/format.md) apply to numeric cells only; non-numeric cells render as plain text regardless. Degrades to the same quiet empty/stale/failure presentation as `stat` for a missing, stale, or failed binding — never throws.',
  },
  row: {
    name: 'row',
    kind: 'container',
    attributes: {
      cols: {
        type: 'string',
        required: false,
        enum: ['2', '3', '4'],
        description:
          'Fixed column count for the row. Defaults to auto-fit (a responsive number of equal-width columns) when absent or not one of the allowed values — an invalid `cols` is never an error.',
      },
      text: TEXT_ALIGN_ATTRIBUTE,
    },
    description:
      "docs/format.md's one layout container, e.g. `:::row{cols=3} ... :::`. Its block children become equal-width cells that wrap responsively and stack on narrow viewports — and simply stack in a plain markdown viewer. No spans, no per-cell sizing, no other knobs. A row always fills the column, so the reserved `align` has nothing to place on it; `text` is what aligns the content inside its cells.",
  },
  cell: {
    name: 'cell',
    kind: 'container',
    attributes: { text: TEXT_ALIGN_ATTRIBUTE },
    description:
      "A transparent grouping container, e.g. `:::cell ... :::`. Its only job is making several blocks count as ONE cell of a `row`: a row's cells are its direct block children, so two blocks are two cells unless a `cell` groups them — and two adjacent task lists, which markdown merges into a single list, can only become two cells by putting one `cell` around each. Its only presentation of its own is `text`, which overrides the enclosing row's; outside a `row` it is inert. The enclosing `row` fence must use MORE colons than its `cell` children (directive container nesting rule), hence `::::row` wrapping `:::cell`.",
  },
  center: layoutWrapperContract(
    'center',
    'Centers narrower-than-column plain markdown (a table, an image) within its scope and sets text alignment for everything in scope, e.g. `:::center ... :::`.',
  ),
  left: layoutWrapperContract(
    'left',
    'Left-aligns plain markdown within its scope and sets text alignment for everything in scope, e.g. `:::left ... :::`. Mostly matches the ambient default; it exists to override an alignment inherited from an enclosing scope, such as opting one cell back out of `:::row{text=center}`.',
  ),
  right: layoutWrapperContract(
    'right',
    'Right-aligns narrower-than-column plain markdown (a table, an image) within its scope and sets text alignment for everything in scope, e.g. `:::right ... :::`.',
  ),
  wide: layoutWrapperContract(
    'wide',
    "Sizes its scope's content to docs/format.md's wide-column width preset, e.g. `:::wide ... :::`.",
  ),
  narrow: layoutWrapperContract(
    'narrow',
    "Sizes its scope's content to docs/format.md's narrow-column width preset, e.g. `:::narrow ... :::`.",
  ),
  full: layoutWrapperContract(
    'full',
    "Sizes its scope's content to the full available document-column width, e.g. `:::full ... :::`.",
  ),
  fit: layoutWrapperContract(
    'fit',
    'Shrinks its scope to the width of its own content rather than filling the column, e.g. `:::fit ... :::`. Pair it with an alignment to place the result, as in `:::fit{align=right} ... :::`.',
  ),
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
