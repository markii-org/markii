import { measureWidth, padText } from '../text-grid.js';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import type { ResolvedLayoutPresets } from '../layout.js';
import {
  childrenText,
  type AnsiComponent,
  type DirectiveAttributes,
} from '../registry.js';
import type { Tier1Token } from '../theme.js';

export type CalloutType = 'info' | 'warning' | 'danger';

const CALLOUT_TYPES: readonly CalloutType[] = ['info', 'warning', 'danger'];

const CALLOUT_ICONS: Record<CalloutType, string> = {
  info: 'ℹ',
  warning: '▲',
  danger: '✕',
};

const CALLOUT_LABELS: Record<CalloutType, string> = {
  info: 'Info',
  warning: 'Warning',
  danger: 'Danger',
};

const CALLOUT_TOKENS: Record<CalloutType, Tier1Token> = {
  info: '--mk-info',
  warning: '--mk-warning',
  danger: '--mk-danger',
};

function isCalloutType(value: string): value is CalloutType {
  return (CALLOUT_TYPES as readonly string[]).includes(value);
}

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** The left bar every line of a callout carries, marking it as one colored block at a glance. */
const BAR = '▌ ';

/** `headerText` for `type`, e.g. `ℹ Info` — needed by both `resolveCalloutInnerWidth` (before there is a component instance) and `Callout` itself. */
function headerTextFor(type: CalloutType): string {
  return `${CALLOUT_ICONS[type]} ${CALLOUT_LABELS[type]}`;
}

/**
 * The inner budget `callout`'s body renders at, given ONLY its own
 * attributes and the outer width — never the body itself. Mirrors
 * `card.ts`'s `resolveCardInnerWidth`: `render.tsx`'s walk calls this
 * BEFORE building children, so a callout's body (and any self-drawing
 * component nested inside it, like a `card`) is built exactly once, at the
 * correct width, never built wide and re-wrapped narrower afterward — see
 * `resolveCardInnerWidth`'s doc comment for why that re-wrap-afterward
 * shape was a real, shipped regression.
 */
export function resolveCalloutInnerWidth(
  attributes: DirectiveAttributes,
  layout: ResolvedLayoutPresets | undefined,
  outerWidth: number,
): number {
  const rawType = attributes.type ?? 'info';
  const type: CalloutType = isCalloutType(rawType) ? rawType : 'info';
  const title = attributes.title ?? null;
  const naturalWidth =
    BAR.length +
    Math.max(measureWidth(headerTextFor(type)), measureWidth(title ?? ''));
  const boxWidth = selfLayoutWidth(layout, outerWidth, naturalWidth);
  return Math.max(1, boxWidth - BAR.length);
}

/**
 * `:::callout{type=info|warning|danger title="..." text=left|center|right}` —
 * a colored aside/warning/danger box. Unknown/missing `type` falls back to
 * `info`. Terminal form: every line carries a colored left bar; the first
 * line is the icon plus the type label, an optional bold title line
 * follows, then the body. `text` aligns the icon/title/body lines within
 * the remaining width.
 *
 * Registered `selfLayout`: every line carries the colored bar prefix, which
 * a generic post-render `applyLayout` narrowing would re-wrap right through,
 * losing the bar on any continuation line. This component reads the
 * resolved `width`/`align` off `ctx.layout` itself and sizes/places its own
 * bar block, exactly like `card`/`table`/`divider`. `children` arrives
 * ALREADY built at exactly this component's own inner width
 * (`resolveCalloutInnerWidth` above) — this component never re-wraps.
 */
export const Callout: AnsiComponent = ({ attributes, children, ctx }) => {
  const rawType = attributes.type ?? 'info';
  const type: CalloutType = isCalloutType(rawType) ? rawType : 'info';
  const token = CALLOUT_TOKENS[type];
  const title = attributes.title ?? null;
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const headerText = headerTextFor(type);
  const titleText = title ? ctx.text(title) : undefined;
  const naturalWidth =
    BAR.length +
    Math.max(measureWidth(headerText), measureWidth(titleText ?? ''));
  const boxWidth = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);

  const bar = ctx.style(BAR, token);
  const innerWidth = Math.max(1, boxWidth - BAR.length);
  const placeLine = (line: string): string =>
    align === 'left' ? line : padText(line, innerWidth, align);

  const headerLine = `${bar}${placeLine(ctx.style(headerText, token))}`;
  const lines = [headerLine];

  if (titleText) {
    lines.push(`${bar}${placeLine(ctx.bold(titleText))}`);
  }

  const body = childrenText(children);
  if (body) {
    for (const line of body.split('\n')) {
      lines.push(`${bar}${placeLine(line)}`);
    }
  }

  return selfLayoutAlign(lines.join('\n'), ctx.layout, ctx.width);
};
