import { measure } from '../measure.js';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import type { AnsiComponent } from '../registry.js';
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

/** The left bar every line of a callout carries, marking it as one colored block at a glance (`box.ts` reserves `│`/`┆` for frames, so this uses the half-block glyph instead). */
const BAR = '▌ ';

/**
 * `:::callout{type=info|warning|danger title="..." text=left|center|right}` —
 * a colored aside/warning/danger box. Unknown/missing `type` falls back to
 * `info` (`render.ts`'s generic invalid-enum notice covers reporting that,
 * same as every other enum attribute). Terminal form: every line carries a
 * colored left bar; the first line is the icon plus the type label, an
 * optional bold title line follows, then the body wrapped to the remaining
 * width. `text` aligns the icon/title/body lines within that remaining
 * width; absent/invalid `text` behaves as `left` (no padding needed).
 *
 * Registered `selfLayout` (`registry.ts`'s `AnsiRegistryEntry.selfLayout`):
 * every line carries the colored bar prefix, which a generic post-render
 * `applyLayout` narrowing would re-wrap right through, losing the bar on any
 * continuation line. This component instead reads the resolved
 * `width`/`align` off `ctx.layout` itself and sizes/places its own bar
 * block, exactly like `card`/`table`/`chart`.
 */
export const Callout: AnsiComponent = (attributes, children, ctx) => {
  const rawType = attributes.type ?? 'info';
  const type: CalloutType = isCalloutType(rawType) ? rawType : 'info';
  const token = CALLOUT_TOKENS[type];
  const title = attributes.title ?? null;
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const headerText = `${CALLOUT_ICONS[type]} ${CALLOUT_LABELS[type]}`;
  const titleText = title ? ctx.text(title) : undefined;
  const naturalWidth =
    BAR.length + Math.max(measure(headerText), measure(titleText ?? ''));
  const boxWidth = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);

  const bar = ctx.style(BAR, token);
  const innerWidth = Math.max(1, boxWidth - BAR.length);
  const placeLine = (line: string): string =>
    align === 'left' ? line : ctx.pad(line, innerWidth, align);

  const headerLine = `${bar}${placeLine(ctx.style(headerText, token))}`;
  const lines = [headerLine];

  if (titleText) {
    lines.push(`${bar}${placeLine(ctx.bold(titleText))}`);
  }

  const childrenText = children({ width: innerWidth });
  if (childrenText) {
    for (const line of childrenText.split('\n')) {
      lines.push(`${bar}${placeLine(line)}`);
    }
  }

  return selfLayoutAlign(lines.join('\n'), ctx.layout, ctx.width);
};
