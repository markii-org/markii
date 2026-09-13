import { colorize, type ColorLevel } from './ansi.js';
import type { AnsiTheme, Tier1Token } from './theme.js';

/**
 * Applies `theme`'s color for `token` to `text` at `level`. Returns `text`
 * unchanged at `level: 'none'` (no escapes to justify) and for a `null`
 * theme entry (a token this engine does not treat as a color, such as a
 * width preset) — both are "nothing to apply", not an error.
 */
export function style(
  text: string,
  token: Tier1Token,
  theme: AnsiTheme,
  level: ColorLevel,
): string {
  const color = theme[token];
  if (!color) return text;
  return colorize(text, color, level);
}
